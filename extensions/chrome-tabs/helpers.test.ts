import { describe, it, expect, vi } from "vitest";
import {
  parseTabList,
  parseWindowList,
  filterTabs,
  formatTabList,
  formatWindowList,
  runOsascript,
  errorResult,
  isChromeAppWindow,
  excludeChromeAppTabs,
  excludeChromeAppWindows,
  type ChromeTab,
  type ChromeWindow,
} from "./helpers.js";

// ── parseTabList ──────────────────────────────────────────────────────────

describe("parseTabList", () => {
  it("parses tab output into structured data", () => {
    const tabs = parseTabList("1\t1\tGoogle\thttps://google.com\n2\t1\tSlack\thttps://slack.com\n");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toEqual({ window: 1, tab: 1, title: "Google", url: "https://google.com" });
  });

  it("returns empty array for empty output", () => {
    expect(parseTabList("")).toEqual([]);
    expect(parseTabList("\n\n")).toEqual([]);
  });

  it("skips lines with fewer than 4 tab-separated parts", () => {
    const tabs = parseTabList("1\t2\tIncomplete\n1\t1\tOK\thttps://ok.com\n");
    expect(tabs).toHaveLength(1);
  });

  it("handles URLs containing tabs", () => {
    const tabs = parseTabList("1\t1\tTitle\thttps://example.com\textra\n");
    expect(tabs[0].url).toBe("https://example.com\textra");
  });
});

// ── parseWindowList ───────────────────────────────────────────────────────

describe("parseWindowList", () => {
  it("parses window output", () => {
    const windows = parseWindowList("Window 1: 3 tabs — active: Home\n");
    expect(windows).toEqual([{ window: 1, tabCount: 3, activeTab: "Home" }]);
  });

  it("returns empty array for empty output", () => {
    expect(parseWindowList("")).toEqual([]);
  });

  it("skips non-matching lines", () => {
    const windows = parseWindowList("garbage\nWindow 2: 1 tab — active: X\n");
    expect(windows).toHaveLength(1);
    expect(windows[0].window).toBe(2);
  });
});

// ── filterTabs ────────────────────────────────────────────────────────────

describe("filterTabs", () => {
  const tabs: ChromeTab[] = [
    { window: 1, tab: 1, title: "Google", url: "https://google.com" },
    { window: 1, tab: 2, title: "GitHub", url: "https://github.com" },
  ];

  it("matches by title case-insensitively", () => {
    expect(filterTabs(tabs, "GITHUB")).toHaveLength(1);
  });

  it("matches by URL", () => {
    expect(filterTabs(tabs, "google.com")).toHaveLength(1);
  });

  it("returns empty when nothing matches", () => {
    expect(filterTabs(tabs, "nope")).toHaveLength(0);
  });
});

// ── formatTabList ─────────────────────────────────────────────────────────

describe("formatTabList", () => {
  it("returns header + rows for tabs", () => {
    const result = formatTabList([{ window: 1, tab: 1, title: "T", url: "U" }]);
    expect(result).toContain("Window\tTab\tTitle\tURL");
    expect(result).toContain("1\t1\tT\tU");
  });

  it("returns placeholder for empty list", () => {
    expect(formatTabList([])).toBe("No tabs found.");
  });
});

// ── formatWindowList ──────────────────────────────────────────────────────

describe("formatWindowList", () => {
  it("formats windows", () => {
    const result = formatWindowList([{ window: 1, tabCount: 5, activeTab: "Home" }]);
    expect(result).toContain("Window 1: 5 tabs");
  });

  it("uses singular for 1 tab", () => {
    const result = formatWindowList([{ window: 1, tabCount: 1, activeTab: "X" }]);
    expect(result).toContain("1 tab —");
  });

  it("returns placeholder for empty list", () => {
    expect(formatWindowList([])).toBe("No Chrome windows found.");
  });
});

// ── runOsascript ──────────────────────────────────────────────────────────

describe("runOsascript", () => {
  it("returns stdout on success", async () => {
    const pi = { exec: vi.fn().mockResolvedValue({ code: 0, stdout: "ok\n", stderr: "" }) };
    expect(await runOsascript(pi, "test")).toBe("ok\n");
  });

  it("throws on non-zero exit with stderr", async () => {
    const pi = { exec: vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "bad" }) };
    await expect(runOsascript(pi, "x")).rejects.toThrow("bad");
  });

  it("throws generic message when stderr is empty", async () => {
    const pi = { exec: vi.fn().mockResolvedValue({ code: 2, stdout: "", stderr: "" }) };
    await expect(runOsascript(pi, "x")).rejects.toThrow("osascript exited with code 2");
  });

  it("passes signal through", async () => {
    const controller = new AbortController();
    const pi = { exec: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }) };
    await runOsascript(pi, "s", controller.signal);
    expect(pi.exec).toHaveBeenCalledWith("osascript", ["-e", "s"], { signal: controller.signal, timeout: 15000 });
  });
});

// ── Chrome App filtering ──────────────────────────────────────────────────

describe("isChromeAppWindow", () => {
  it("returns true for single-tab Gmail window", () => {
    expect(isChromeAppWindow([{ window: 4, tab: 1, title: "Inbox", url: "https://mail.google.com/mail/u/0/#inbox" }])).toBe(true);
  });

  it("returns true for single-tab Calendar window", () => {
    expect(isChromeAppWindow([{ window: 5, tab: 1, title: "Calendar", url: "https://calendar.google.com/calendar/u/0/r" }])).toBe(true);
  });

  it("returns true for single-tab Meet window", () => {
    expect(isChromeAppWindow([{ window: 6, tab: 1, title: "Meet", url: "https://meet.google.com/landing" }])).toBe(true);
  });

  it("returns false for multi-tab window even with app URL", () => {
    expect(isChromeAppWindow([
      { window: 1, tab: 1, title: "Inbox", url: "https://mail.google.com/" },
      { window: 1, tab: 2, title: "Other", url: "https://example.com" },
    ])).toBe(false);
  });

  it("returns false for single-tab window with non-app URL", () => {
    expect(isChromeAppWindow([{ window: 1, tab: 1, title: "GitHub", url: "https://github.com" }])).toBe(false);
  });

  it("returns false for empty window", () => {
    expect(isChromeAppWindow([])).toBe(false);
  });
});

describe("excludeChromeAppTabs", () => {
  it("removes tabs from Chrome App windows", () => {
    const tabs: ChromeTab[] = [
      { window: 1, tab: 1, title: "GitHub", url: "https://github.com" },
      { window: 1, tab: 2, title: "Slack", url: "https://slack.com" },
      { window: 2, tab: 1, title: "Gmail", url: "https://mail.google.com/mail/u/0" },
      { window: 3, tab: 1, title: "Meet", url: "https://meet.google.com/landing" },
    ];
    const result = excludeChromeAppTabs(tabs);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.window === 1)).toBe(true);
  });

  it("returns all tabs when no Chrome App windows exist", () => {
    const tabs: ChromeTab[] = [
      { window: 1, tab: 1, title: "A", url: "https://a.com" },
      { window: 2, tab: 1, title: "B", url: "https://b.com" },
    ];
    expect(excludeChromeAppTabs(tabs)).toHaveLength(2);
  });

  it("returns empty for all-app tabs", () => {
    const tabs: ChromeTab[] = [
      { window: 1, tab: 1, title: "Gmail", url: "https://mail.google.com/" },
      { window: 2, tab: 1, title: "Meet", url: "https://meet.google.com/" },
    ];
    expect(excludeChromeAppTabs(tabs)).toHaveLength(0);
  });
});

describe("excludeChromeAppWindows", () => {
  it("removes Chrome App windows from the window list", () => {
    const windows: ChromeWindow[] = [
      { window: 1, tabCount: 10, activeTab: "GitHub" },
      { window: 2, tabCount: 1, activeTab: "Gmail" },
      { window: 3, tabCount: 1, activeTab: "Meet" },
    ];
    const tabs: ChromeTab[] = [
      { window: 1, tab: 1, title: "GitHub", url: "https://github.com" },
      { window: 2, tab: 1, title: "Gmail", url: "https://mail.google.com/mail" },
      { window: 3, tab: 1, title: "Meet", url: "https://meet.google.com/landing" },
    ];
    const result = excludeChromeAppWindows(windows, tabs);
    expect(result).toHaveLength(1);
    expect(result[0].window).toBe(1);
  });

  it("keeps all windows when none are Chrome Apps", () => {
    const windows: ChromeWindow[] = [
      { window: 1, tabCount: 5, activeTab: "A" },
      { window: 2, tabCount: 3, activeTab: "B" },
    ];
    const tabs: ChromeTab[] = [
      { window: 1, tab: 1, title: "A", url: "https://a.com" },
      { window: 2, tab: 1, title: "B", url: "https://b.com" },
    ];
    expect(excludeChromeAppWindows(windows, tabs)).toHaveLength(2);
  });
});

// ── errorResult ───────────────────────────────────────────────────────────

describe("errorResult", () => {
  it("returns error-shaped tool result", () => {
    const r = errorResult("boom");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("boom");
    expect(r.details.error).toBe("boom");
  });
});
