import { describe, it, expect } from "vitest";
import * as scripts from "./scripts.js";

describe("AppleScript templates", () => {
  describe("constants", () => {
    it("LIST_TABS contains the Chrome tell block", () => {
      expect(scripts.LIST_TABS).toContain('tell application "Google Chrome"');
      expect(scripts.LIST_TABS).toContain("count windows");
    });

    it("LIST_WINDOWS contains the Chrome tell block", () => {
      expect(scripts.LIST_WINDOWS).toContain('tell application "Google Chrome"');
      expect(scripts.LIST_WINDOWS).toContain("active tab");
    });

    it("COUNT_TABS returns a number", () => {
      expect(scripts.COUNT_TABS).toContain("return n");
    });

    it("CLOSE_DUPLICATES iterates in reverse", () => {
      expect(scripts.CLOSE_DUPLICATES).toContain("to 1 by -1");
      expect(scripts.CLOSE_DUPLICATES).toContain("seenUrls");
    });
  });

  describe("builder functions", () => {
    it("getTabTitle targets correct window and tab", () => {
      const script = scripts.getTabTitle(2, 5);
      expect(script).toContain("tab 5 of window 2");
      expect(script).toContain("title");
    });

    it("switchTab activates and brings window to front", () => {
      const script = scripts.switchTab(1, 3);
      expect(script).toContain("set active tab index of window 1 to 3");
      expect(script).toContain("set index of window 1 to 1");
      expect(script).toContain("activate");
    });

    it("openTab escapes double quotes in URL", () => {
      const script = scripts.openTab('https://example.com/path?q="test"', 2);
      expect(script).toContain("window 2");
      expect(script).toContain('\\"test\\"');
      expect(script).toContain("activate");
    });

    it("openTab handles clean URLs", () => {
      const script = scripts.openTab("https://google.com", 1);
      expect(script).toContain("https://google.com");
    });

    it("closeTab targets correct window and tab", () => {
      const script = scripts.closeTab(3, 7);
      expect(script).toContain("close tab 7 of window 3");
    });

    it("reloadTab with specific tab uses URL re-assignment", () => {
      const script = scripts.reloadTab(1, 4);
      expect(script).toContain("tab 4 of window 1");
      expect(script).toContain("set URL of tab");
    });

    it("reloadTab without tab reloads active tab", () => {
      const script = scripts.reloadTab(2);
      expect(script).toContain("reload active tab of window 2");
    });
  });
});
