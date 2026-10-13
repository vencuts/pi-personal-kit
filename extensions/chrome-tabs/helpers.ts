/**
 * Types, parsers, filters, and formatters for Chrome tab data.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface ChromeTab {
  window: number;
  tab: number;
  title: string;
  url: string;
}

export interface ChromeWindow {
  window: number;
  tabCount: number;
  activeTab: string;
}

/** Minimal interface for pi.exec — keeps helpers testable without the full ExtensionAPI. */
export interface ExecProvider {
  exec: (cmd: string, args: string[], opts?: any) => Promise<{ code: number; stdout: string; stderr: string }>;
}

// ── osascript runner ──────────────────────────────────────────────────────

export async function runOsascript(
  pi: ExecProvider,
  script: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await pi.exec("osascript", ["-e", script], { signal, timeout: 15000 });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `osascript exited with code ${result.code}`);
  }
  return result.stdout;
}

// ── Parsers ───────────────────────────────────────────────────────────────

/** Parse the TSV output from LIST_TABS into structured ChromeTab objects. */
export function parseTabList(output: string): ChromeTab[] {
  const tabs: ChromeTab[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 4) {
      tabs.push({
        window: parseInt(parts[0], 10),
        tab: parseInt(parts[1], 10),
        title: parts[2],
        url: parts.slice(3).join("\t"),
      });
    }
  }
  return tabs;
}

/** Parse the "Window N: X tabs — active: Title" output into ChromeWindow objects. */
export function parseWindowList(output: string): ChromeWindow[] {
  const windows: ChromeWindow[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^Window (\d+): (\d+) tabs? — active: (.+)$/);
    if (match) {
      windows.push({
        window: parseInt(match[1], 10),
        tabCount: parseInt(match[2], 10),
        activeTab: match[3],
      });
    }
  }
  return windows;
}

// ── Filters ───────────────────────────────────────────────────────────────

/** Case-insensitive filter: matches against both title and URL. */
export function filterTabs(tabs: ChromeTab[], pattern: string): ChromeTab[] {
  const lower = pattern.toLowerCase();
  return tabs.filter(
    (t) => t.title.toLowerCase().includes(lower) || t.url.toLowerCase().includes(lower),
  );
}

/**
 * URL prefixes that identify Chrome App windows (Gmail, Calendar, Meet, etc.).
 * These are typically single-tab windows created by "Install as app" or
 * "Create shortcut" and clutter tab listings.
 */
const CHROME_APP_URL_PREFIXES = [
  "https://mail.google.com/",
  "https://calendar.google.com/",
  "https://meet.google.com/",
  "https://docs.google.com/spreadsheets/",
  "https://chat.google.com/",
  "https://messages.google.com/",
];

/**
 * Returns true if a window looks like a Chrome App (PWA) window.
 * Heuristic: a single-tab window whose URL matches a known Chrome App pattern.
 */
export function isChromeAppWindow(windowTabs: ChromeTab[]): boolean {
  if (windowTabs.length !== 1) return false;
  const url = windowTabs[0].url.toLowerCase();
  return CHROME_APP_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Filter out tabs belonging to Chrome App windows.
 * Groups tabs by window, removes windows that look like Chrome Apps,
 * and returns the remaining tabs.
 */
export function excludeChromeAppTabs(tabs: ChromeTab[]): ChromeTab[] {
  const byWindow = new Map<number, ChromeTab[]>();
  for (const t of tabs) {
    let group = byWindow.get(t.window);
    if (!group) {
      group = [];
      byWindow.set(t.window, group);
    }
    group.push(t);
  }
  const result: ChromeTab[] = [];
  for (const windowTabs of byWindow.values()) {
    if (!isChromeAppWindow(windowTabs)) {
      result.push(...windowTabs);
    }
  }
  return result;
}

/**
 * Filter out Chrome App windows from a window list.
 * Uses the same heuristic: single-tab windows with known app URL patterns.
 * Requires the full tab list to check URLs.
 */
export function excludeChromeAppWindows(
  windows: ChromeWindow[],
  tabs: ChromeTab[],
): ChromeWindow[] {
  const appWindowNumbers = new Set<number>();
  const byWindow = new Map<number, ChromeTab[]>();
  for (const t of tabs) {
    let group = byWindow.get(t.window);
    if (!group) {
      group = [];
      byWindow.set(t.window, group);
    }
    group.push(t);
  }
  for (const [windowNum, windowTabs] of byWindow) {
    if (isChromeAppWindow(windowTabs)) {
      appWindowNumbers.add(windowNum);
    }
  }
  return windows.filter((w) => !appWindowNumbers.has(w.window));
}

// ── Formatters ────────────────────────────────────────────────────────────

/** Format tabs as a TSV string with a header row. */
export function formatTabList(tabs: ChromeTab[]): string {
  if (tabs.length === 0) return "No tabs found.";
  const lines = ["Window\tTab\tTitle\tURL"];
  for (const t of tabs) {
    lines.push(`${t.window}\t${t.tab}\t${t.title}\t${t.url}`);
  }
  return lines.join("\n");
}

/** Format windows as a human-readable summary. */
export function formatWindowList(windows: ChromeWindow[]): string {
  if (windows.length === 0) return "No Chrome windows found.";
  const lines: string[] = [];
  for (const w of windows) {
    lines.push(`Window ${w.window}: ${w.tabCount} tab${w.tabCount === 1 ? "" : "s"} — active: ${w.activeTab}`);
  }
  return lines.join("\n");
}

// ── Tool result helpers ───────────────────────────────────────────────────

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { error: message },
    isError: true,
  };
}
