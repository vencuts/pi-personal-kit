import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const TRIGGER = /think\s+deeply/i;

  pi.on("agent_request", async (event, ctx) => {
    const lastMsg = event.messages?.[event.messages.length - 1];
    if (!lastMsg) return;

    const text =
      typeof lastMsg.content === "string"
        ? lastMsg.content
        : Array.isArray(lastMsg.content)
          ? lastMsg.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join(" ")
          : "";

    if (TRIGGER.test(text)) {
      const prev = pi.getThinkingLevel();
      if (prev !== "xhigh") {
        pi.setThinkingLevel("xhigh");
        ctx.ui.notify("🧠 Thinking level → xhigh", "info");
      }
    }
  });
}
