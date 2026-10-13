import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createConnection } from "node:net";

const SOCKET = process.env.ZMUX_SOCKET_PATH || "/tmp/zmux.sock";
const SURFACE_ID = process.env.ZMUX_SURFACE_ID || "";

// ─── Socket RPC Helper ─────────────────────────────────────────────
function rpc(method: string, params: Record<string, any> = {}): Promise<any> {
  // Auto-inject surface for browser affinity — ensures each agent
  // targets the browser pane in its own workspace, not the first one in the DOM
  if (SURFACE_ID && !params.surface) {
    params = { ...params, surface: SURFACE_ID };
  }
  return new Promise((resolve, reject) => {
    const client = createConnection(SOCKET, () => {
      client.write(JSON.stringify({ id: "pi", method, params }) + "\n");
    });
    let buf = "";
    client.on("data", (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        try {
          const res = JSON.parse(buf.slice(0, nl));
          if (res.ok) resolve(res.result);
          else reject(new Error(res.error || "zmux error"));
        } catch (e) {
          reject(e);
        }
        client.end();
      }
    });
    client.on("error", (e) =>
      reject(new Error(`Cannot connect to zmux at ${SOCKET}: ${e.message}`))
    );
    client.setTimeout(10000, () => {
      reject(new Error("zmux timeout"));
      client.end();
    });
  });
}

function isZmuxRunning(): boolean {
  try {
    require("node:fs").accessSync(SOCKET);
    return true;
  } catch {
    return false;
  }
}

// ─── Extension ──────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  // Only register tools if zmux is running
  if (!isZmuxRunning()) return;

  // ── Browser Interaction Guidelines ────────────────────────────────
  // These teach the agent the see→think→act workflow
  const BROWSER_GUIDELINES = [
    "BROWSER WORKFLOW: Always use zmux_browser_do for browser interactions. It handles the see→act loop for you.",
    "zmux_browser_do with action='look' returns BOTH a screenshot AND structured text. Start with this.",
    "After 'look', chain multiple zmux_browser_do calls: look → click → look → type → look. Each returns the page state AFTER the action.",
    "The snapshot returns elements marked [e1], [e2] etc. The Interactive Elements legend at the bottom maps refs to CSS selectors. Use those selectors for click/type actions.",
    "IMPORTANT: After clicking, the page may change (modal opens, navigation). Always 'look' again after clicking to see the new state.",
    "For search: look → click search input → type query → click search button or press Enter. Chain these as separate zmux_browser_do calls.",
  ];

  // ── Browser Do (high-level reasoning action) ──────────────────────
  pi.registerTool({
    name: "zmux_browser_do",
    label: "zmux Browser Action",
    description:
      "Perform a high-level browser action. Takes a screenshot + snapshot of the current page, then executes a click or type action based on the goal. This is the primary tool for interacting with the browser — describe WHAT you want to do and this tool handles the see→act workflow. Examples: 'click the Sign In button', 'type hello into the search box', 'click the first search result'.",
    promptSnippet: "See the browser page and perform an action (click, type, scroll)",
    promptGuidelines: BROWSER_GUIDELINES,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("click"),
        Type.Literal("type"),
        Type.Literal("scroll"),
        Type.Literal("look"),
      ], { description: "Action type: 'click' an element, 'type' into an input, 'scroll' down, or 'look' to just observe" }),
      target: Type.Optional(Type.String({ description: "CSS selector OR description of what to interact with (e.g. 'the search input', '#login-btn', 'button.submit')" })),
      text: Type.Optional(Type.String({ description: "Text to type (for 'type' action)" })),
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
      const surface = params.surface;

      // Helper: take screenshot + snapshot of current state
      const captureState = async () => {
        let screenshot: any[] = [];
        try {
          const p = `/tmp/zmux-do-${Date.now()}.png`;
          const ss = await rpc("browser.screenshot", { surface, path: p });
          const fs = require("node:fs");
          const data = fs.readFileSync(ss.path);
          screenshot = [{ type: "image" as const, data: data.toString("base64"), mimeType: "image/png" as const }];
          fs.unlinkSync(ss.path);
        } catch (e) {}
        const snap = await rpc("browser.snapshot", { surface });
        return { screenshot, snap };
      };

      try {
        // ── LOOK: just observe ──
        if (params.action === "look") {
          const { screenshot, snap } = await captureState();
          return {
            content: [
              { type: "text", text: `URL: ${snap.url}\nTitle: ${snap.title}\nInteractive elements: ${snap.interactiveCount || 0}\n${"─".repeat(60)}\n${snap.snapshot}` },
              ...screenshot,
            ],
            details: snap,
          };
        }

        // ── SCROLL ──
        if (params.action === "scroll") {
          await rpc("browser.eval", { surface, script: "window.scrollBy(0, 600)" });
          await wait(800);
          const { screenshot, snap } = await captureState();
          return {
            content: [
              { type: "text", text: `Scrolled down.\n\nURL: ${snap.url}\nTitle: ${snap.title}\n${"─".repeat(60)}\n${snap.snapshot}` },
              ...screenshot,
            ],
            details: snap,
          };
        }

        // ── CLICK ──
        if (params.action === "click" && params.target) {
          await rpc("browser.click", { selector: params.target, surface });
          // Wait for page reaction (modals, navigation, AJAX)
          await wait(2000);
          const { screenshot, snap } = await captureState();
          return {
            content: [
              { type: "text", text: `Clicked "${params.target}".\n\nURL: ${snap.url}\nTitle: ${snap.title}\nInteractive elements: ${snap.interactiveCount || 0}\n${"─".repeat(60)}\n${snap.snapshot}` },
              ...screenshot,
            ],
            details: snap,
          };
        }

        // ── TYPE ──
        if (params.action === "type" && params.target && params.text) {
          await rpc("browser.type", { selector: params.target, text: params.text, surface });
          await wait(500);
          const { screenshot, snap } = await captureState();
          return {
            content: [
              { type: "text", text: `Typed "${params.text}" into "${params.target}".\n\nURL: ${snap.url}\nTitle: ${snap.title}\n${"─".repeat(60)}\n${snap.snapshot}` },
              ...screenshot,
            ],
            details: snap,
          };
        }

        // Fallback: just look
        const { screenshot, snap } = await captureState();
        return {
          content: [
            { type: "text", text: `URL: ${snap.url}\nTitle: ${snap.title}\n${"─".repeat(60)}\n${snap.snapshot}` },
            ...screenshot,
          ],
          details: snap,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Snapshot ──────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_snapshot",
    label: "zmux Browser Snapshot",
    description:
      "Get a text snapshot of the page currently open in zmux's browser pane. Returns the URL, title, and a structured text representation with interactive element refs [e1], [e2] etc. Use the selectors from the Interactive Elements legend for zmux_browser_click/zmux_browser_type.",
    promptSnippet: "Read the zmux browser pane content as structured text with element refs",
    promptGuidelines: BROWSER_GUIDELINES,
    parameters: Type.Object({
      surface: Type.Optional(
        Type.String({ description: "Target browser surface ID (optional, defaults to first browser)" })
      ),
    }),
    async execute(_id, params) {
      try {
        const result = await rpc("browser.snapshot", params);
        const meta = result.meta || {};
        const lines = [
          `URL: ${result.url}`,
          `Title: ${result.title}`,
          meta.description ? `Description: ${meta.description}` : "",
          `Interactive elements: ${result.interactiveCount || 0}`,
          "─".repeat(60),
          result.snapshot || "(empty page)",
          "",
          "Note: Elements marked [eN] can be clicked using zmux_browser_click with the CSS selector shown in the Interactive Elements legend.",
        ].filter(Boolean);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: result,
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  // ── Browser Navigate ──────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_navigate",
    label: "zmux Browser Navigate",
    description:
      "Navigate the zmux browser pane to a URL. The browser is authenticated with your Chrome session (Google, GitHub, etc.).",
    promptSnippet: "Navigate zmux browser to a URL",
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to" }),
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        await rpc("browser.navigate", params);
        // Wait a moment for page to load, then snapshot
        await new Promise((r) => setTimeout(r, 2000));
        const snap = await rpc("browser.snapshot", { surface: params.surface });
        return {
          content: [
            {
              type: "text",
              text: `Navigated to ${params.url}\n\nTitle: ${snap.title}\n${"─".repeat(60)}\n${snap.snapshot || "(loading...)"}`,
            },
          ],
          details: snap,
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          details: {},
          isError: true,
        };
      }
    },
  });

  // ── Browser URL ───────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_url",
    label: "zmux Browser URL",
    description: "Get the current URL and title of the zmux browser pane.",
    promptSnippet: "Get current zmux browser URL and title",
    parameters: Type.Object({
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        const result = await rpc("browser.url", params);
        return {
          content: [{ type: "text", text: `URL: ${result.url}\nTitle: ${result.title}` }],
          details: result,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Eval ──────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_eval",
    label: "zmux Browser Eval",
    description:
      "Execute JavaScript in the zmux browser pane and return the result. Useful for extracting specific data, interacting with page elements, or checking page state.",
    promptSnippet: "Run JavaScript in the zmux browser pane",
    parameters: Type.Object({
      script: Type.String({ description: "JavaScript to execute in the browser context" }),
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        const result = await rpc("browser.eval", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result.result, null, 2) }],
          details: result,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Click ─────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_click",
    label: "zmux Browser Click",
    description: "Click an element in the zmux browser pane using a CSS selector.",
    promptSnippet: "Click an element in the zmux browser",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of element to click" }),
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        await rpc("browser.click", params);
        await new Promise((r) => setTimeout(r, 1000));
        const snap = await rpc("browser.snapshot", { surface: params.surface });
        return {
          content: [{ type: "text", text: `Clicked ${params.selector}\n\n${snap.snapshot || ""}` }],
          details: snap,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Type ──────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_type",
    label: "zmux Browser Type",
    description: "Type text into an input field in the zmux browser pane.",
    promptSnippet: "Type into an input in the zmux browser",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of the input element" }),
      text: Type.String({ description: "Text to type" }),
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        await rpc("browser.type", params);
        return {
          content: [{ type: "text", text: `Typed "${params.text}" into ${params.selector}` }],
          details: {},
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Screenshot (returns inline image to the model) ────────
  pi.registerTool({
    name: "zmux_browser_screenshot",
    label: "zmux Browser Screenshot",
    description:
      "Take a screenshot of the zmux browser pane and return it as an inline image. The model can see the screenshot visually. Use this to verify visual layout, check UI state, or see what the user sees.",
    promptSnippet: "Screenshot the zmux browser (returns image the model can see)",
    promptGuidelines: [
      "Use zmux_browser_screenshot when you need to visually verify a page layout, check UI state, or see exactly what the user sees in the browser. The screenshot is returned as an inline image.",
    ],
    parameters: Type.Object({
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        const screenshotPath = `/tmp/zmux-screenshot-${Date.now()}.png`;
        const result = await rpc("browser.screenshot", { ...params, path: screenshotPath });

        // Read the screenshot and return as inline image
        const fs = require("node:fs");
        const data = fs.readFileSync(result.path);
        const base64 = data.toString("base64");
        fs.unlinkSync(result.path); // clean up

        return {
          content: [
            { type: "text", text: `Screenshot of browser (${result.size} bytes)` },
            { type: "image", data: base64, mimeType: "image/png" },
          ],
          details: {},
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Console Logs ──────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_console",
    label: "zmux Browser Console",
    description:
      "Get console log output from the zmux browser pane. Includes JavaScript logs, warnings, and errors. Useful for debugging frontend issues.",
    promptSnippet: "Read browser console logs (JS errors, warnings, debug output)",
    parameters: Type.Object({
      level: Type.Optional(
        Type.String({ description: "Filter by level: 'log', 'warn', 'error'. Omit for all." })
      ),
      limit: Type.Optional(Type.Number({ description: "Max entries to return (default 50)" })),
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        const result = await rpc("browser.console", params);
        if (!result.logs || result.logs.length === 0) {
          return { content: [{ type: "text", text: "No console output." }], details: {} };
        }
        const lines = result.logs.map(
          (l: any) => `[${l.level.toUpperCase()}] ${l.message}${l.source ? ` (${l.source}:${l.line})` : ""}`
        );
        return {
          content: [{ type: "text", text: `${result.total} total entries, showing ${result.logs.length}:\n\n${lines.join("\n")}` }],
          details: result,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Errors ────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_errors",
    label: "zmux Browser Errors",
    description: "Get JavaScript errors from the zmux browser pane. Use this to debug frontend crashes and exceptions.",
    promptSnippet: "Get JS errors from the browser",
    parameters: Type.Object({
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        const result = await rpc("browser.errors", params);
        if (!result.errors || result.errors.length === 0) {
          return { content: [{ type: "text", text: "No JavaScript errors." }], details: {} };
        }
        const lines = result.errors.map(
          (e: any) => `❌ ${e.message}${e.source ? `\n   at ${e.source}:${e.line}` : ""}`
        );
        return {
          content: [{ type: "text", text: `${result.total} error(s):\n\n${lines.join("\n\n")}` }],
          details: result,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser List ──────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_list",
    label: "zmux Browser List",
    description: "List all open browser panes in zmux with their URLs and titles.",
    promptSnippet: "List all zmux browser panes",
    parameters: Type.Object({}),
    async execute() {
      try {
        const result = await rpc("browser.list");
        if (!result || result.length === 0) {
          return { content: [{ type: "text", text: "No browser panes open" }], details: {} };
        }
        const lines = result.map(
          (b: any) => `• ${b.surface}: ${b.title || "(untitled)"} — ${b.url}`
        );
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { browsers: result },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Notify ────────────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_notify",
    label: "zmux Notify",
    description:
      "Send a desktop notification through zmux. Use this to alert the user when long tasks complete.",
    promptSnippet: "Send a zmux desktop notification",
    parameters: Type.Object({
      title: Type.String({ description: "Notification title" }),
      body: Type.String({ description: "Notification body" }),
    }),
    async execute(_id, params) {
      try {
        await rpc("notification.create", params);
        return { content: [{ type: "text", text: "Notification sent" }], details: {} };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Markdown Viewer ────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_markdown_view",
    label: "zmux Markdown Viewer",
    description:
      "Render a markdown file or string in zmux's browser pane as a beautifully formatted document. Use this when the user asks to view, preview, or read a .md file — or when you want to present formatted content (plans, docs, reports) in a readable way instead of raw terminal output.",
    promptSnippet: "Render markdown in the zmux browser as a beautiful document",
    promptGuidelines: [
      "When the user asks to 'open', 'view', 'preview', or 'read' a .md file, use zmux_markdown_view instead of the read tool.",
      "You can also render your own markdown content (plans, reports, summaries) by passing it as the content parameter.",
      "The rendered document supports GFM tables, task lists, code blocks with syntax labels, blockquotes, and images.",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Path to a .md file to render" })),
      content: Type.Optional(Type.String({ description: "Markdown string to render (alternative to path)" })),
      title: Type.Optional(Type.String({ description: "Title for the rendered document (used with content)" })),
    }),
    async execute(_id, params) {
      if (!params.path && !params.content) {
        return { content: [{ type: "text", text: "Provide either a path to a .md file or markdown content to render." }], details: {}, isError: true };
      }
      try {
        const result = await rpc("markdown.render", params);
        return {
          content: [{ type: "text", text: `📄 Rendered "${result.title}" in the zmux browser pane.` }],
          details: result,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Design Mode ────────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_design_mode",
    label: "zmux Design Mode",
    description:
      "Open a Design Mode workspace in zmux. Creates a split layout with a narrow terminal pane for the agent and a wide browser pane showing the dev server preview. Includes a CSS inspector panel and responsive viewport toggles. Use this when doing frontend/UI work.",
    promptSnippet: "Open a design workspace with live preview + CSS inspector",
    promptGuidelines: [
      "Use zmux_design_mode when the user is working on frontend/UI and wants a visual preview alongside the terminal.",
      "Pass the dev server URL (e.g. http://localhost:3000) as the url parameter.",
      "The design panel lets you click elements to inspect CSS, change viewport sizes, and send instructions to the agent.",
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Dev server URL to preview (default: http://localhost:3000)" })),
    }),
    async execute(_id, params) {
      try {
        await rpc("design.open", { url: params.url || "http://localhost:3000" });
        return {
          content: [{ type: "text", text: "Design Mode workspace opened. Browser shows the preview, CSS inspector is on the right. Click elements to inspect styles." }],
          details: {},
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: "Error: " + e.message }], details: {}, isError: true };
      }
    },
  });

  // ── Annotate Start ────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_annotate_start",
    label: "zmux Start Annotations",
    description:
      "Enable annotation mode on the zmux browser. The user can then click elements on the page and add feedback comments. Use this when the user wants to give visual feedback on a webpage. After they're done annotating, use zmux_annotate_get to read their feedback.",
    promptSnippet: "Enable browser annotation mode for user feedback",
    parameters: Type.Object({
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        await rpc("annotate.start", params);
        return {
          content: [{ type: "text", text: "Annotation mode enabled. The user can now click elements in the browser to add feedback. When they're done, use zmux_annotate_get to read their comments." }],
          details: {},
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Annotate Get ──────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_annotate_get",
    label: "zmux Get Annotations",
    description:
      "Get all annotations the user has added to elements in the zmux browser. Each annotation includes the element selector, text content, and the user's feedback comment. Use this after the user has been annotating to read their feedback.",
    promptSnippet: "Read user annotations from the zmux browser",
    parameters: Type.Object({
      surface: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        const result = await rpc("annotate.list", params);
        if (!result.annotations || result.annotations.length === 0) {
          return { content: [{ type: "text", text: "No annotations yet. The user hasn't added any feedback." }], details: {} };
        }
        const lines = result.annotations.map((a: any, i: number) => {
          return `${i + 1}. <${a.tag}> "${a.text?.substring(0, 60) || ''}"
   Selector: ${a.selector}
   Feedback: ${a.comment}`;
        });
        return {
          content: [{ type: "text", text: `${result.count} annotation(s):\n\n${lines.join("\n\n")}` }],
          details: result,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Annotate Stop ─────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_annotate_stop",
    label: "zmux Stop Annotations",
    description: "Disable annotation mode on the zmux browser.",
    promptSnippet: "Disable browser annotation mode",
    parameters: Type.Object({}),
    async execute() {
      try {
        await rpc("annotate.stop");
        return { content: [{ type: "text", text: "Annotation mode disabled." }], details: {} };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Workspace List ────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_workspace_list",
    label: "zmux Workspace List",
    description: "List all zmux workspaces.",
    promptSnippet: "List zmux workspaces",
    parameters: Type.Object({}),
    async execute() {
      try {
        const result = await rpc("workspace.list");
        const lines = result.map(
          (w: any) => `${w.active ? "▸" : " "} ${w.name} (${w.id})`
        );
        return { content: [{ type: "text", text: lines.join("\n") }], details: { workspaces: result } };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── /annotate command ──────────────────────────────────────────────
  pi.registerCommand("annotate", {
    description: "Read browser annotations. Use after annotating elements in the zmux browser.",
    handler: async (args, ctx) => {
      try {
        const result = await rpc("annotate.list");
        if (!result.annotations || result.annotations.length === 0) {
          ctx.ui.notify("No annotations yet. Use the ✏️ button in the browser to annotate elements.", "info");
          return;
        }
        // Build a message with all annotations and send as user message
        const lines = result.annotations.map((a: any, i: number) =>
          `${i + 1}. <${a.tag}> "${a.text?.substring(0, 60) || ''}" [${a.selector}]\n   → ${a.comment}`
        );
        const url = await rpc("browser.url").catch(() => ({ url: "unknown" }));
        const msg = `The user annotated ${result.count} element(s) on ${url.url || "the browser page"}:\n\n${lines.join("\n\n")}\n\nPlease address each annotation.`;
        pi.sendUserMessage(msg);
      } catch (e: any) {
        ctx.ui.notify(`Error: ${e.message}`, "error");
      }
    },
  });

  // ── Auto-check for annotations on agent start ─────────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    if (!isZmuxRunning()) return;
    try {
      const result = await rpc("annotate.list");
      if (result.annotations && result.annotations.length > 0) {
        const lines = result.annotations.map((a: any, i: number) =>
          `${i + 1}. <${a.tag}> "${a.text?.substring(0, 60)}"\n   Feedback: ${a.comment}`
        );
        const url = await rpc("browser.url").catch(() => ({ url: "" }));
        return {
          message: {
            customType: "zmux-annotations",
            content: `[zmux] ${result.count} browser annotation(s) pending on ${url.url || "the page"}:\n\n${lines.join("\n\n")}`,
            display: true,
          },
        };
      }
    } catch (e) {}
  });

  // ── Dropped Image Handler ──────────────────────────────────────────
  // When user drops an image into the terminal, detect the path and 
  // offer to read it as an inline image
  pi.on("input", async (event, ctx) => {
    const text = event.text?.trim() || "";
    // Check if the input looks like a dropped image path
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)('|")?$/i.test(text) && !text.includes(" ") || 
        (text.startsWith("'") && text.endsWith("'") && /\.(png|jpg|jpeg|gif|webp)$/i.test(text))) {
      const imgPath = text.replace(/^'|'$/g, "").replace(/^"|"$/g, "");
      try {
        const fs = require("node:fs");
        if (fs.existsSync(imgPath)) {
          // Transform the input to use pi's read tool which handles images natively
          return { action: "transform" as const, text: `Look at this image: ${imgPath}` };
        }
      } catch (e) {}
    }
  });

  // ── Session start ─────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("zmux", "🖥 zmux connected");
  });

  // ── Notify on agent stop ─────────────────────────────────────────
  pi.on("agent_end", async (_event, ctx) => {
    if (!isZmuxRunning()) return;
    try {
      const surface = process.env.ZMUX_SURFACE_ID || undefined;
      await rpc("notification.create", { title: "pi", body: "Agent finished", surface });
      await rpc("workspace.set_activity", { activity: "done", surface });

    } catch (e) {}
  });

  pi.on("agent_start", async () => {
    if (!isZmuxRunning()) return;
    try {
      const surface = process.env.ZMUX_SURFACE_ID || undefined;
      await rpc("workspace.set_activity", { activity: "thinking", surface });
    } catch (e) {}
  });

  // ── Workspace Rename ──────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_workspace_rename",
    label: "zmux Rename Workspace",
    description: "Rename a zmux workspace.",
    promptSnippet: "Rename zmux workspace",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Current workspace name" })),
      id: Type.Optional(Type.String({ description: "Workspace ID" })),
      newName: Type.String({ description: "New name for the workspace" }),
    }),
    async execute({ name, id, newName }) {
      try {
        const result = await rpc("workspace.rename", { name, id, newName });
        return { content: [{ type: "text", text: `Renamed to: ${result.name}` }], details: result };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Browser Scroll ────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_browser_scroll",
    label: "zmux Browser Scroll",
    description: "Scroll the browser page up or down. Positive dy scrolls down, negative scrolls up. Shows an animated cursor.",
    promptSnippet: "Scroll the zmux browser",
    parameters: Type.Object({
      dy: Type.Optional(Type.Number({ description: "Pixels to scroll (positive=down, negative=up). Default: 600" })),
    }),
    async execute({ dy }) {
      try {
        await rpc("browser.scroll", { dy: dy ?? 600 });
        return { content: [{ type: "text", text: `Scrolled ${(dy ?? 600) > 0 ? 'down' : 'up'} ${Math.abs(dy ?? 600)}px` }], details: {} };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  // ── Remotion Workspace ────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_remotion_open",
    label: "zmux Remotion Studio",
    description: "Open a Remotion workspace in zmux. Creates a split layout with a terminal running `npm run studio` and a browser pane that auto-navigates to localhost:3000 when the dev server is ready.",
    promptSnippet: "Open Remotion studio workspace",
    parameters: Type.Object({
      dir: Type.Optional(Type.String({ description: "Project directory path" })),
    }),
    async execute({ dir }) {
      try {
        await rpc("remotion.open", { dir: dir || process.cwd() });
        return { content: [{ type: "text", text: "Remotion workspace opened. Terminal is starting the studio, browser will auto-navigate when ready." }], details: {} };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });


  // ── Wiki Tools ────────────────────────────────────────────────────

  pi.registerTool({
    name: "zmux_wiki_read",
    label: "zmux Wiki Read",
    description: "Read a page from the zmux wiki. Pages are flat .md files in ~/.config/zmux/wiki/",
    promptSnippet: "Read a wiki page",
    parameters: Type.Object({
      page: Type.String({ description: "Page filename, e.g. zmux.md or impact-review.md" }),
    }),
    async execute({ page }: { page: string }) {
      try {
        if (!page) return { content: [{ type: "text", text: "Error: page is required" }], details: {}, isError: true };
        const result = await rpc("wiki.read", { page });
        return { content: [{ type: "text", text: result.content }], details: { page: result.page } };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Page not found: ${page}` }], details: {}, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "zmux_wiki_write",
    label: "zmux Wiki Write",
    description: "Create or update a wiki page. Pages live in ~/.config/zmux/wiki/. Use [[page-name]] for cross-references between pages.",
    promptSnippet: "Write a wiki page",
    parameters: Type.Object({
      page: Type.String({ description: "Page filename, e.g. zmux.md or enrichment-engine.md" }),
      content: Type.String({ description: "Full markdown content for the page" }),
    }),
    async execute({ page, content }: { page: string; content: string }) {
      try {
        if (!page) return { content: [{ type: "text", text: "Error: page is required" }], details: {}, isError: true };
        if (!content) return { content: [{ type: "text", text: "Error: content is required" }], details: {}, isError: true };
        const result = await rpc("wiki.write", { page, content });
        return { content: [{ type: "text", text: `Wiki page written: ${page}` }], details: result };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "zmux_wiki_search",
    label: "zmux Wiki Search",
    description: "Search the zmux wiki knowledge base. Returns matching pages with snippets.",
    promptSnippet: "Search the wiki",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    async execute({ query }) {
      try {
        const results = await rpc("wiki.search", { query });
        if (results.length === 0) return { content: [{ type: "text", text: "No wiki pages found for: " + query }], details: {} };
        const lines = results.map((r: any) => `${r.path} — ${r.snippet}`);
        return { content: [{ type: "text", text: lines.join("\n") }], details: { results } };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "zmux_wiki_list",
    label: "zmux Wiki List",
    description: "List all pages in the zmux wiki knowledge base.",
    promptSnippet: "List wiki pages",
    parameters: Type.Object({}),
    async execute() {
      try {
        const pages = await rpc("wiki.list");
        if (pages.length === 0) return { content: [{ type: "text", text: "Wiki is empty. It will grow automatically from your work sessions." }], details: {} };
        const lines = pages.map((p: any) => `${p.path} (${new Date(p.modified).toLocaleDateString()})`);
        return { content: [{ type: "text", text: lines.join("\n") }], details: { pages } };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });


  pi.registerTool({
    name: "zmux_wiki_find_related",
    label: "zmux Wiki Find Related",
    description: "Find existing wiki pages related to a topic. Returns pages ranked by relevance. Use to check what already exists before writing.",
    promptSnippet: "Find related wiki pages for a topic",
    parameters: Type.Object({
      topic: Type.String({ description: "Topic to find related pages for" }),
    }),
    async execute({ topic }) {
      try {
        const results = await rpc("wiki.find_related", { topic });
        if (results.length === 0) return { content: [{ type: "text", text: "No related pages found for: " + topic + ". Safe to create a new page." }], details: {} };
        const lines = results.map((r: any) => `[${r.relevance}] ${r.path} (score ${r.score})`);
        return { content: [{ type: "text", text: "Related pages:\n" + lines.join("\n") }], details: { results } };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });




  // ── Wiki Ingest ───────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_wiki_ingest",
    label: "zmux Wiki Ingest",
    description: "Ingest raw content into the zmux wiki. Automatically compiles it into structured wiki pages using AI — finds related existing pages via semantic search, updates instead of duplicating, adds changelog entries. Use this instead of wiki_write when you have raw notes, meeting transcripts, articles, or unstructured content.",
    promptSnippet: "Ingest raw content into the wiki for compilation",
    parameters: Type.Object({
      content: Type.String({ description: "Raw content to ingest (notes, transcript, article, etc.)" }),
      source_name: Type.Optional(Type.String({ description: "Short name for the source (e.g. 'standup-apr-11', 'architecture-doc')" })),
    }),
    async execute({ content, source_name }: { content: string; source_name?: string }) {
      try {
        const r = await rpc("wiki.ingest", { content, source_name: source_name || "agent-ingest" });
        if (r.error) return { content: [{ type: "text", text: "Error: " + r.error }], details: {}, isError: true };
        const lines = ["Ingested: " + (r.summary || "saved")];
        if (r.pages) r.pages.forEach((p: any) => lines.push("  " + p.action + ": " + p.path));
        if (r.raw) lines.push("Raw saved: " + r.raw);
        return { content: [{ type: "text", text: lines.join("\n") }], details: r };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });


  // ── Image Generation ───────────────────────────────────────────
  pi.registerTool({
    name: "zmux_image_generate",
    label: "zmux Image Generate",
    description: "Generate an image using AI (nano banana pro via fal). Prompt is automatically enhanced for best quality. The image appears in the zmux image-gen pane. Returns the image URL.",
    promptSnippet: "Generate an image",
    parameters: Type.Object({
      prompt: Type.String({ description: "What to generate (e.g. 'a sunset over mountains')" }),
      size: Type.Optional(Type.String({ description: "Image size: square_hd, landscape_16_9, portrait_16_9, landscape_4_3" })),
    }),
    async execute({ prompt, size }: { prompt: string; size?: string }) {
      try {
        const r = await rpc("image-gen.generate", { prompt, size: size || "landscape_16_9" });
        if (r.error) return { content: [{ type: "text", text: "Error: " + r.error }], details: {}, isError: true };
        return { content: [{ type: "text", text: "Generated: " + r.url + "\nEnhanced prompt: " + (r.enhanced || prompt) }], details: r };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });


  // ── File Explorer ─────────────────────────────────────────────────
  pi.registerTool({
    name: "zmux_files_open",
    label: "zmux File Explorer",
    description: "Open a file explorer pane in zmux showing the project directory tree. Files can be previewed with syntax highlighting. Useful for showing the user what files you created or modified.",
    promptSnippet: "Open file explorer in zmux",
    parameters: Type.Object({
      dir: Type.Optional(Type.String({ description: "Directory to show. Defaults to workspace cwd." })),
    }),
    async execute({ dir }: { dir?: string }) {
      try {
        // Open files plugin pane
        await rpc("plugin.open", { type: "files", dir });
        return { content: [{ type: "text", text: "File explorer opened" + (dir ? " at " + dir : "") }], details: {} };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], details: {}, isError: true };
      }
    },
  });

}