import { describe, it, expect, vi, beforeEach } from "vitest";
import initExtension from "./index.js";

// ── Test helpers ──────────────────────────────────────────────────────────

type HandlerFn = (...args: any[]) => Promise<any>;

interface MockTool {
  name: string;
  execute: (...args: any[]) => Promise<any>;
  renderCall: (args: any, theme: any) => any;
  renderResult: (result: any, opts: any, theme: any) => any;
  [key: string]: any;
}

function createMockPi() {
  const handlers = new Map<string, HandlerFn[]>();
  const tools = new Map<string, MockTool>();
  const commands = new Map<string, { description: string; handler: HandlerFn }>();

  return {
    on: vi.fn((event: string, handler: HandlerFn) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    registerTool: vi.fn((tool: MockTool) => {
      tools.set(tool.name, tool);
    }),
    registerCommand: vi.fn((name: string, opts: any) => {
      commands.set(name, opts);
    }),
    exec: vi.fn(),
    tools,
    commands,
    handlers,
  };
}

function mockTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

const SAMPLE_TAB_OUTPUT = [
  "1\t1\tGoogle\thttps://google.com",
  "1\t2\tGitHub\thttps://github.com",
  "2\t1\tSlack\thttps://app.slack.com/client",
  "",
].join("\n");

const SAMPLE_WINDOW_OUTPUT = [
  "Window 1: 2 tabs — active: Google",
  "Window 2: 1 tab — active: Slack",
  "",
].join("\n");

// ── Extension integration tests ───────────────────────────────────────────

describe("chromeTabsExtension", () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  });

  function setPlatform(value: string) {
    Object.defineProperty(process, "platform", { value, configurable: true });
  }

  function restorePlatform() {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  }

  describe("platform gating", () => {
    it("does not register tools on non-macOS", () => {
      setPlatform("linux");
      const pi = createMockPi();
      initExtension(pi as any);
      expect(pi.registerTool).not.toHaveBeenCalled();
      expect(pi.registerCommand).not.toHaveBeenCalled();
      restorePlatform();
    });

    it("registers tool and command on macOS", () => {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      expect(pi.registerTool).toHaveBeenCalledTimes(1);
      expect(pi.registerCommand).toHaveBeenCalledTimes(1);
      expect(pi.tools.has("chrome_tabs")).toBe(true);
      expect(pi.commands.has("chrome-tabs")).toBe(true);
      restorePlatform();
    });
  });

  describe("tool actions", () => {
    function setupTool() {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      return pi;
    }

    async function execAction(pi: ReturnType<typeof createMockPi>, params: Record<string, any>) {
      const tool = pi.tools.get("chrome_tabs")!;
      return tool.execute("test-id", params, undefined, undefined, {});
    }

    it("list — returns all tabs", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      const result = await execAction(pi, { action: "list" });
      expect(result.details.action).toBe("list");
      expect(result.details.count).toBe(3);
      expect(result.content[0].text).toContain("Google");
      restorePlatform();
    });

    it("list — returns 'No tabs found' when Chrome has no tabs", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "\n", stderr: "" });
      const result = await execAction(pi, { action: "list" });
      expect(result.details.count).toBe(0);
      expect(result.content[0].text).toBe("No tabs found.");
      restorePlatform();
    });

    it("windows — returns window summary", async () => {
      const pi = setupTool();
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: SAMPLE_WINDOW_OUTPUT, stderr: "" });
      const result = await execAction(pi, { action: "windows" });
      expect(result.details.action).toBe("windows");
      expect(result.details.windowCount).toBe(2);
      expect(result.details.totalTabs).toBe(3);
      expect(result.content[0].text).toContain("Total: 3 tabs across 2 windows");
      restorePlatform();
    });

    it("windows — returns 'No Chrome windows' when empty", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "\n", stderr: "" });
      const result = await execAction(pi, { action: "windows" });
      expect(result.details.windowCount).toBe(0);
      expect(result.content[0].text).toContain("No Chrome windows found.");
      restorePlatform();
    });

    it("windows — singular tab/window", async () => {
      const pi = setupTool();
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: "1\t1\tTest\thttps://test.com\n", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "Window 1: 1 tab — active: Test\n", stderr: "" });
      const result = await execAction(pi, { action: "windows" });
      expect(result.content[0].text).toContain("1 tab");
      expect(result.content[0].text).toContain("1 windows");
      restorePlatform();
    });

    it("windows — filters out Chrome App windows", async () => {
      const pi = setupTool();
      const tabOutput = "1\t1\tGitHub\thttps://github.com\n2\t1\tGmail\thttps://mail.google.com/mail\n";
      const windowOutput = "Window 1: 1 tab — active: GitHub\nWindow 2: 1 tab — active: Gmail\n";
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: tabOutput, stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: windowOutput, stderr: "" });
      const result = await execAction(pi, { action: "windows" });
      expect(result.details.windowCount).toBe(1);
      restorePlatform();
    });

    it("count — returns tab count excluding Chrome Apps", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      const result = await execAction(pi, { action: "count" });
      expect(result.details.count).toBe(3);
      expect(result.content[0].text).toBe("3 tabs open");
      restorePlatform();
    });

    it("count — singular for 1 tab", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "1\t1\tTest\thttps://test.com\n", stderr: "" });
      const result = await execAction(pi, { action: "count" });
      expect(result.content[0].text).toBe("1 tab open");
      restorePlatform();
    });

    it("find — returns matching tabs", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      const result = await execAction(pi, { action: "find", pattern: "github" });
      expect(result.details.matched).toBe(1);
      expect(result.details.total).toBe(3);
      restorePlatform();
    });

    it("find — returns no-match message", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      const result = await execAction(pi, { action: "find", pattern: "nonexistent" });
      expect(result.details.matched).toBe(0);
      expect(result.content[0].text).toContain("No tabs matching");
      restorePlatform();
    });

    it("find — errors without pattern", async () => {
      const pi = setupTool();
      const result = await execAction(pi, { action: "find" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("pattern");
      restorePlatform();
    });

    it("switch — switches to tab", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
      const result = await execAction(pi, { action: "switch", window: 1, tab: 3 });
      expect(result.details.action).toBe("switch");
      expect(result.content[0].text).toContain("window 1, tab 3");
      restorePlatform();
    });

    it("switch — errors without tab", async () => {
      const pi = setupTool();
      const result = await execAction(pi, { action: "switch" });
      expect(result.isError).toBe(true);
      restorePlatform();
    });

    it("switch — defaults window to 1", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
      const result = await execAction(pi, { action: "switch", tab: 2 });
      expect(result.content[0].text).toContain("window 1, tab 2");
      restorePlatform();
    });

    it("open — opens URL in new tab", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
      const result = await execAction(pi, { action: "open", url: "https://example.com", window: 2 });
      expect(result.details.action).toBe("open");
      expect(result.content[0].text).toContain("https://example.com");
      expect(result.content[0].text).toContain("window 2");
      restorePlatform();
    });

    it("open — errors without URL", async () => {
      const pi = setupTool();
      const result = await execAction(pi, { action: "open" });
      expect(result.isError).toBe(true);
      restorePlatform();
    });

    it("close — closes tab by index", async () => {
      const pi = setupTool();
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: "My Tab Title", stderr: "" }) // getTitle
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // close
      const result = await execAction(pi, { action: "close", window: 1, tab: 2 });
      expect(result.details.action).toBe("close");
      expect(result.content[0].text).toContain("My Tab Title");
      restorePlatform();
    });

    it("close — closes tabs by pattern", async () => {
      const pi = setupTool();
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" }) // list
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // close
      const result = await execAction(pi, { action: "close", pattern: "slack" });
      expect(result.details.closed).toBe(1);
      restorePlatform();
    });

    it("close — closes multiple tabs in the same window (tests sort by tab index)", async () => {
      const pi = setupTool();
      const multiTabOutput = [
        "1\t1\tGoogle\thttps://google.com",
        "1\t2\tGoogle Maps\thttps://maps.google.com",
        "1\t3\tGoogle Drive\thttps://drive.google.com",
        "",
      ].join("\n");
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: multiTabOutput, stderr: "" }) // list
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // close tab 3
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // close tab 2
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // close tab 1
      const result = await execAction(pi, { action: "close", pattern: "google" });
      expect(result.details.closed).toBe(3);
      expect(result.content[0].text).toContain("3 tabs");
      restorePlatform();
    });

    it("close — singular message for 1 tab by pattern", async () => {
      const pi = setupTool();
      const singleTabOutput = "1\t1\tSlack\thttps://slack.com\n";
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: singleTabOutput, stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      const result = await execAction(pi, { action: "close", pattern: "slack" });
      expect(result.content[0].text).toBe('Closed 1 tab matching "slack"');
      restorePlatform();
    });

    it("close — by pattern with no matches", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      const result = await execAction(pi, { action: "close", pattern: "nonexistent" });
      expect(result.details.closed).toBe(0);
      expect(result.content[0].text).toContain("No tabs matching");
      restorePlatform();
    });

    it("close — errors without tab or pattern", async () => {
      const pi = setupTool();
      const result = await execAction(pi, { action: "close" });
      expect(result.isError).toBe(true);
      restorePlatform();
    });

    it("close_duplicates — removes duplicate tabs", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "3\n", stderr: "" });
      const result = await execAction(pi, { action: "close_duplicates" });
      expect(result.details.closed).toBe(3);
      expect(result.content[0].text).toContain("3 duplicate tabs");
      restorePlatform();
    });

    it("close_duplicates — singular for 1", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "1\n", stderr: "" });
      const result = await execAction(pi, { action: "close_duplicates" });
      expect(result.content[0].text).toBe("Closed 1 duplicate tab");
      restorePlatform();
    });

    it("reload — reloads specific tab", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
      const result = await execAction(pi, { action: "reload", window: 1, tab: 2 });
      expect(result.content[0].text).toContain("tab 2 in window 1");
      restorePlatform();
    });

    it("reload — reloads active tab when no tab specified", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
      const result = await execAction(pi, { action: "reload" });
      expect(result.content[0].text).toContain("active tab in window 1");
      restorePlatform();
    });

    it("handles osascript errors gracefully", async () => {
      const pi = setupTool();
      pi.exec.mockResolvedValue({ code: 1, stdout: "", stderr: "Chrome not running" });
      const result = await execAction(pi, { action: "list" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Chrome not running");
      restorePlatform();
    });

    it("handles non-Error thrown objects", async () => {
      const pi = setupTool();
      pi.exec.mockRejectedValue("string error");
      const result = await execAction(pi, { action: "list" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("string error");
      restorePlatform();
    });

    it("handles unknown action", async () => {
      const pi = setupTool();
      const result = await execAction(pi, { action: "unknown_action" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown action");
      restorePlatform();
    });
  });

  describe("renderCall", () => {
    it("renders action with pattern", () => {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      const tool = pi.tools.get("chrome_tabs")!;
      const result = tool.renderCall({ action: "find", pattern: "slack" }, mockTheme());
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders action with URL", () => {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      const tool = pi.tools.get("chrome_tabs")!;
      const result = tool.renderCall({ action: "open", url: "https://example.com" }, mockTheme());
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders action with window and tab", () => {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      const tool = pi.tools.get("chrome_tabs")!;
      const result = tool.renderCall({ action: "close", window: 1, tab: 3 }, mockTheme());
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders plain action", () => {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      const tool = pi.tools.get("chrome_tabs")!;
      const result = tool.renderCall({ action: "list" }, mockTheme());
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders with missing action", () => {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      const tool = pi.tools.get("chrome_tabs")!;
      const result = tool.renderCall({}, mockTheme());
      expect(result).toBeDefined();
      restorePlatform();
    });
  });

  describe("renderResult", () => {
    function setupRenderer() {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      return pi.tools.get("chrome_tabs")!;
    }

    it("renders error result", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { isError: true, content: [{ type: "text", text: "error msg" }], details: {} },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders error from details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "err" }], details: { error: "bad" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders error without text content", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { isError: true, content: [], details: {} },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders list summary collapsed", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "tab data" }], details: { action: "list", count: 5 } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders list summary expanded", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "tab data" }], details: { action: "list", count: 5 } },
        { expanded: true },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders windows summary", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "windows", windowCount: 3, totalTabs: 10 } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders count summary", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "count", count: 7 } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders find summary", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "find", matched: 2, total: 10, pattern: "test" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders close summary singular", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "close", closed: 1 } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders close summary plural", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "close", closed: 5 } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders close_duplicates summary", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "close_duplicates", closed: 2 } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders close_duplicates singular", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "close_duplicates", closed: 1 } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders unknown action as fallback", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "reload" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders with empty details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: {} },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders with null details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: null },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders list with missing count in details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "list" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders windows with missing fields in details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "windows" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders count with missing count in details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "count" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders find with missing fields in details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "find" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders close with missing closed in details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "close" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders close_duplicates with missing closed in details", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "text", text: "data" }], details: { action: "close_duplicates" } },
        { expanded: false },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders expanded with missing text content", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [], details: { action: "list", count: 1 } },
        { expanded: true },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });

    it("renders expanded with non-text content", () => {
      const tool = setupRenderer();
      const result = tool.renderResult(
        { content: [{ type: "image", data: "abc" }], details: { action: "list", count: 1 } },
        { expanded: true },
        mockTheme(),
      );
      expect(result).toBeDefined();
      restorePlatform();
    });
  });

  describe("/chrome-tabs command", () => {
    function setupCommand() {
      setPlatform("darwin");
      const pi = createMockPi();
      initExtension(pi as any);
      const cmd = pi.commands.get("chrome-tabs")!;
      const ctx = { ui: { notify: vi.fn() } };
      return { pi, cmd, ctx };
    }

    it("windows (default action)", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: SAMPLE_WINDOW_OUTPUT, stderr: "" });
      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("3 tabs"), "info");
      restorePlatform();
    });

    it("list action", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      await cmd.handler("list", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Google"), "info");
      restorePlatform();
    });

    it("count action", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      await cmd.handler("count", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("3 tabs open", "info");
      restorePlatform();
    });

    it("find action with pattern", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      await cmd.handler("find github", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("GitHub"), "info");
      restorePlatform();
    });

    it("find action with no matches", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec.mockResolvedValue({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" });
      await cmd.handler("find nonexistent", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("No tabs matching"), "info");
      restorePlatform();
    });

    it("find action without pattern shows warning", async () => {
      const { cmd, ctx } = setupCommand();
      await cmd.handler("find", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /chrome-tabs find <pattern>", "warning");
      restorePlatform();
    });

    it("unknown action shows usage", async () => {
      const { cmd, ctx } = setupCommand();
      await cmd.handler("badcmd", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage"), "warning");
      restorePlatform();
    });

    it("handles errors gracefully", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec.mockResolvedValue({ code: 1, stdout: "", stderr: "Chrome not running" });
      await cmd.handler("list", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Chrome not running"), "error");
      restorePlatform();
    });

    it("handles non-Error thrown in command", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec.mockRejectedValue("raw string error");
      await cmd.handler("list", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("raw string error"), "error");
      restorePlatform();
    });

    it("handles null args", async () => {
      const { pi, cmd, ctx } = setupCommand();
      pi.exec
        .mockResolvedValueOnce({ code: 0, stdout: SAMPLE_TAB_OUTPUT, stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: SAMPLE_WINDOW_OUTPUT, stderr: "" });
      await cmd.handler(null, ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("3 tabs"), "info");
      restorePlatform();
    });
  });
});
