/**
 * Chrome Tabs Extension
 *
 * Manage the user's real Chrome browser tabs via macOS AppleScript.
 * List, find, close, switch, open, deduplicate, and reload tabs across
 * all Chrome windows. Unlike the chrome-devtools extension (which controls
 * an isolated browser), this talks to the user's actual Chrome instance.
 *
 * macOS only — requires Google Chrome and AppleScript automation permissions.
 *
 * Tools:  chrome_tabs
 * Commands: /chrome-tabs
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";

import {
  runOsascript,
  parseTabList,
  parseWindowList,
  filterTabs,
  formatTabList,
  formatWindowList,
  errorResult,
  excludeChromeAppTabs,
  excludeChromeAppWindows,
} from "./helpers.js";

import * as scripts from "./scripts.js";

// Re-export for tests
export { runOsascript, parseTabList, parseWindowList, filterTabs } from "./helpers.js";
export type { ChromeTab, ChromeWindow } from "./helpers.js";

// ── Extension entry point ─────────────────────────────────────────────────

export default function chromeTabsExtension(pi: ExtensionAPI) {
  if (process.platform !== "darwin") return;

  pi.registerTool({
    name: "chrome_tabs",
    label: "Chrome Tabs",
    description:
      "Manage the user's real Chrome browser tabs. Actions: list (all tabs), windows (window summary), count, find (by pattern), switch (focus tab), open (new tab), close (by index or pattern), close_duplicates, reload.",
    promptSnippet:
      "Manage real Chrome tabs: list, find, close, switch, open, deduplicate. macOS only.",
    promptGuidelines: [
      "Use chrome_tabs to manage the user's actual Chrome browser, not the isolated DevTools browser.",
      "Always list or find first to get current window/tab indices before switching or closing.",
      "Tab indices are 1-based and shift after closing — re-list if needed.",
    ],
    parameters: Type.Object({
      action: StringEnum(
        ["list", "windows", "count", "find", "switch", "open", "close", "close_duplicates", "reload"] as const,
        { description: "The tab management action to perform." },
      ),
      pattern: Type.Optional(
        Type.String({ description: "Search pattern for find/close actions (matches title or URL, case-insensitive)." }),
      ),
      window: Type.Optional(
        Type.Number({ description: "Window number (1-based). Defaults to 1." }),
      ),
      tab: Type.Optional(
        Type.Number({ description: "Tab number within the window (1-based)." }),
      ),
      url: Type.Optional(
        Type.String({ description: "URL to open (for the open action)." }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const w = params.window ?? 1;

        switch (params.action) {
          case "list": {
            const raw = await runOsascript(pi, scripts.LIST_TABS, signal);
            const tabs = excludeChromeAppTabs(parseTabList(raw));
            return {
              content: [{ type: "text", text: formatTabList(tabs) }],
              details: { action: "list", count: tabs.length },
            };
          }

          case "windows": {
            const tabRaw = await runOsascript(pi, scripts.LIST_TABS, signal);
            const allTabs = parseTabList(tabRaw);
            const winRaw = await runOsascript(pi, scripts.LIST_WINDOWS, signal);
            const windows = excludeChromeAppWindows(parseWindowList(winRaw), allTabs);
            const total = windows.reduce((sum, win) => sum + win.tabCount, 0);
            return {
              content: [{ type: "text", text: formatWindowList(windows) + `\n\nTotal: ${total} tabs across ${windows.length} windows` }],
              details: { action: "windows", windowCount: windows.length, totalTabs: total },
            };
          }

          case "count": {
            const raw = await runOsascript(pi, scripts.LIST_TABS, signal);
            const count = excludeChromeAppTabs(parseTabList(raw)).length;
            return {
              content: [{ type: "text", text: `${count} tab${count === 1 ? "" : "s"} open` }],
              details: { action: "count", count },
            };
          }

          case "find": {
            if (!params.pattern) {
              return errorResult("The 'pattern' parameter is required for the find action.");
            }
            const raw = await runOsascript(pi, scripts.LIST_TABS, signal);
            const allTabs = excludeChromeAppTabs(parseTabList(raw));
            const matched = filterTabs(allTabs, params.pattern);
            return {
              content: [{ type: "text", text: matched.length > 0 ? formatTabList(matched) : `No tabs matching "${params.pattern}"` }],
              details: { action: "find", pattern: params.pattern, matched: matched.length, total: allTabs.length },
            };
          }

          case "switch": {
            if (params.tab === undefined) {
              return errorResult("The 'tab' parameter is required for the switch action.");
            }
            await runOsascript(pi, scripts.switchTab(w, params.tab), signal);
            return {
              content: [{ type: "text", text: `Switched to window ${w}, tab ${params.tab}` }],
              details: { action: "switch", window: w, tab: params.tab },
            };
          }

          case "open": {
            if (!params.url) {
              return errorResult("The 'url' parameter is required for the open action.");
            }
            await runOsascript(pi, scripts.openTab(params.url, w), signal);
            return {
              content: [{ type: "text", text: `Opened ${params.url} in window ${w}` }],
              details: { action: "open", url: params.url, window: w },
            };
          }

          case "close": {
            if (params.pattern) {
              const raw = await runOsascript(pi, scripts.LIST_TABS, signal);
              const allTabs = excludeChromeAppTabs(parseTabList(raw));
              const matched = filterTabs(allTabs, params.pattern);
              if (matched.length === 0) {
                return {
                  content: [{ type: "text", text: `No tabs matching "${params.pattern}" to close.` }],
                  details: { action: "close", pattern: params.pattern, closed: 0 },
                };
              }
              // Close in reverse order to avoid index shift
              const sorted = [...matched].sort(
                (a, b) => b.window - a.window || b.tab - a.tab,
              );
              for (const t of sorted) {
                await runOsascript(pi, scripts.closeTab(t.window, t.tab), signal);
              }
              return {
                content: [{ type: "text", text: `Closed ${matched.length} tab${matched.length === 1 ? "" : "s"} matching "${params.pattern}"` }],
                details: { action: "close", pattern: params.pattern, closed: matched.length },
              };
            }

            if (params.tab === undefined) {
              return errorResult("Either 'tab' or 'pattern' is required for the close action.");
            }
            const title = (await runOsascript(pi, scripts.getTabTitle(w, params.tab), signal)).trim();
            await runOsascript(pi, scripts.closeTab(w, params.tab), signal);
            return {
              content: [{ type: "text", text: `Closed: ${title}` }],
              details: { action: "close", window: w, tab: params.tab, title },
            };
          }

          case "close_duplicates": {
            const raw = await runOsascript(pi, scripts.CLOSE_DUPLICATES, signal);
            const closed = parseInt(raw.trim(), 10);
            return {
              content: [{ type: "text", text: `Closed ${closed} duplicate tab${closed === 1 ? "" : "s"}` }],
              details: { action: "close_duplicates", closed },
            };
          }

          case "reload": {
            await runOsascript(pi, scripts.reloadTab(w, params.tab), signal);
            const target = params.tab !== undefined ? `tab ${params.tab} in window ${w}` : `active tab in window ${w}`;
            return {
              content: [{ type: "text", text: `Reloaded ${target}` }],
              details: { action: "reload", window: w, tab: params.tab },
            };
          }

          default:
            return errorResult(`Unknown action: ${params.action}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }
    },

    // ── TUI rendering ───────────────────────────────────────────────────

    renderCall(args, theme) {
      const action = args.action ?? "?";
      let detail = String(action);
      if (args.pattern) detail += ` "${args.pattern}"`;
      if (args.url) detail += ` ${args.url}`;
      if (typeof args.window === "number" && typeof args.tab === "number") {
        detail += ` w${args.window}:t${args.tab}`;
      }

      return new Text(
        theme.fg("toolTitle", theme.bold("Chrome Tabs ")) + theme.fg("muted", detail),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = (result.details ?? {}) as Record<string, any>;
      const isError = (result as any).isError || details.error;
      if (isError) {
        const text = result.content?.[0]?.type === "text" ? result.content[0].text : "Chrome Tabs error";
        return new Text(theme.fg("error", `✗ ${text}`), 0, 0);
      }

      const action = details.action ?? "";
      let summary: string;

      switch (action) {
        case "list":
          summary = `${details.count ?? 0} tabs`;
          break;
        case "windows":
          summary = `${details.windowCount ?? 0} windows, ${details.totalTabs ?? 0} tabs`;
          break;
        case "count":
          summary = `${details.count ?? 0} tabs`;
          break;
        case "find":
          summary = `${details.matched ?? 0}/${details.total ?? 0} matched "${details.pattern ?? ""}"`;
          break;
        case "close":
          summary = `closed ${details.closed ?? 1} tab${(details.closed ?? 1) === 1 ? "" : "s"}`;
          break;
        case "close_duplicates":
          summary = `closed ${details.closed ?? 0} duplicate${(details.closed ?? 0) === 1 ? "" : "s"}`;
          break;
        default:
          summary = action;
      }

      let line = theme.fg("success", "✓ ") + theme.fg("muted", summary);

      if (!expanded) return new Text(line, 0, 0);

      const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
      return new Text(`${line}\n\n${text}`, 0, 0);
    },
  });

  // ── Command ───────────────────────────────────────────────────────────

  pi.registerCommand("chrome-tabs", {
    description: "Manage Chrome tabs — /chrome-tabs [list|windows|count|find <pattern>]",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const action = parts[0] || "windows";
      const rest = parts.slice(1).join(" ");

      try {
        switch (action) {
          case "windows": {
            const tabRaw = await runOsascript(pi, scripts.LIST_TABS);
            const allTabs = parseTabList(tabRaw);
            const winRaw = await runOsascript(pi, scripts.LIST_WINDOWS);
            const windows = excludeChromeAppWindows(parseWindowList(winRaw), allTabs);
            const total = windows.reduce((sum, win) => sum + win.tabCount, 0);
            ctx.ui.notify(`${total} tabs\n${formatWindowList(windows)}`, "info");
            break;
          }
          case "list": {
            const raw = await runOsascript(pi, scripts.LIST_TABS);
            const tabs = excludeChromeAppTabs(parseTabList(raw));
            ctx.ui.notify(formatTabList(tabs), "info");
            break;
          }
          case "count": {
            const raw = await runOsascript(pi, scripts.LIST_TABS);
            const count = excludeChromeAppTabs(parseTabList(raw)).length;
            ctx.ui.notify(`${count} tabs open`, "info");
            break;
          }
          case "find": {
            if (!rest) {
              ctx.ui.notify("Usage: /chrome-tabs find <pattern>", "warning");
              return;
            }
            const raw = await runOsascript(pi, scripts.LIST_TABS);
            const allTabs = excludeChromeAppTabs(parseTabList(raw));
            const matched = filterTabs(allTabs, rest);
            ctx.ui.notify(
              matched.length > 0
                ? formatTabList(matched)
                : `No tabs matching "${rest}"`,
              "info",
            );
            break;
          }
          default:
            ctx.ui.notify("Usage: /chrome-tabs [list|windows|count|find <pattern>]", "warning");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Chrome Tabs error: ${message}`, "error");
      }
    },
  });
}
