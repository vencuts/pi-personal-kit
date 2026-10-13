import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";

const HOME = process.env.HOME || os.homedir();
const HANDOFF_DIR = path.join(HOME, "Documents", "pi-compact-handoffs");
const STATE_DIR = path.join(HOME, ".pi", "agent", "state");
const STATE_FILE = path.join(STATE_DIR, "pre-compact-safety.json");
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const REQUIRED_SECTIONS = [
  "## Current goal",
  "## Exact next action",
  "## Open decisions",
  "## Slack permalinks",
  "## PRs and commits",
  "## File paths touched",
  "## Commands and results that matter",
  "## What not to forget",
  "## Done vs pending",
  "## Where to resume",
  "## Verification",
];

type HandoffState = {
  path: string;
  sha256: string;
  sessionFile?: string;
  createdAt: string;
  verifiedAt: string;
};

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: any) => {
      if (!block) return "";
      if (block.type === "text") return block.text || "";
      if (block.type === "toolCall" || block.type === "tool_use") {
        const args = block.arguments || block.input || {};
        return `[tool:${block.name || "unknown"}] ${JSON.stringify(args).slice(0, 500)}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function truncate(text: string, max = 1600): string {
  const clean = (text || "").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.floor(max * 0.7)).trimEnd()}\n...[truncated ${clean.length - max} chars]...\n${clean.slice(-Math.floor(max * 0.3)).trimStart()}`;
}

function list(items: string[], empty: string): string {
  const unique = Array.from(new Set(items.filter(Boolean)));
  if (unique.length === 0) return `- ${empty}`;
  return unique.slice(0, 80).map((item) => `- ${item}`).join("\n");
}

function matchAll(text: string, regex: RegExp): string[] {
  return Array.from(text.matchAll(regex)).map((match) => match[0].replace(/[),.;\]]+$/, ""));
}

function branchEntries(ctx: any): any[] {
  try {
    return ctx.sessionManager?.getBranch?.() || [];
  } catch {
    return [];
  }
}

function recentEntries(ctx: any): string {
  const entries = branchEntries(ctx).slice(-40);
  return entries.map((entry: any) => {
    if (entry.type === "message") {
      const message = entry.message || {};
      if (message.role === "toolResult") {
        return `- toolResult ${message.toolName || "tool"}: ${truncate(textContent(message.content), 500)}`;
      }
      return `- ${message.role || "message"}: ${truncate(textContent(message.content), 700)}`;
    }
    if (entry.type === "compaction") return `- compaction: ${truncate(entry.summary || "", 500)}`;
    return `- ${entry.type || "entry"}`;
  }).join("\n");
}

function buildHandoff(ctx: any): string {
  const entriesText = recentEntries(ctx);
  const sessionFile = ctx.sessionManager?.getSessionFile?.() || "unknown";
  const sessionName = ctx.sessionManager?.getSessionName?.() || "unnamed";
  const cwd = ctx.cwd || process.cwd();
  const now = new Date().toISOString();
  const slack = matchAll(entriesText, /https:\/\/[\w-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+(?:\?[^\s)\]]*)?/g);
  const prRefs = matchAll(entriesText, /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pull|issues)\/\d+|\bPR\s+#\d+|\bu2\s+#\d+/g);
  const commits = matchAll(entriesText, /\b[0-9a-f]{7,40}\b/gi).filter((value) => /[a-f]/i.test(value));
  const files = matchAll(entriesText, /(?:~|\/Users\/[A-Za-z0-9_.-]+|\/home\/[A-Za-z0-9_.-]+)\/[A-Za-z0-9_@./:+=, -]+|\b(?:[A-Za-z0-9_.-]+\/){1,6}[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b/g);
  const decisions = matchAll(entriesText, /\bD\d{1,4}\b/g);

  return `# Pi compact checkpoint — ${now}

## Current goal
- Session: ${sessionName}
- Session file: ${sessionFile}
- Working directory: ${cwd}

## Exact next action
- Resume from the most recent explicit user direction in the session. If uncertain, ask the user before changing files.

## Open decisions
${list(decisions, "No D-number decisions detected in recent session entries.")}

## Slack permalinks
${list(slack, "No Slack permalinks detected in recent session entries.")}

## PRs and commits
### PRs/issues/u2
${list(prRefs, "No PR, issue, or u2 refs detected in recent session entries.")}

### Commits
${list(commits, "No commit hashes detected in recent session entries.")}

## File paths touched
${list(files, "No file paths detected in recent session entries.")}

## Commands and results that matter
- Review recent entries below. The checkpoint intentionally avoids reinterpreting command outputs.

## What not to forget
- Do not trust compaction as the only memory layer.
- Durable handoff first. Compact second.
- After compaction, verify this checkpoint before continuing.
- Before every future change, state implications, risk, rollback, and get approval.

## Done vs pending
- See recent session entries and taskQueue.md after compaction.

## Where to resume
1. Open this checkpoint file.
2. Verify its SHA256 sidecar.
3. Read taskQueue.md and dailyContext.md if needed.
4. Continue only after confirming the checkpoint survived.

## Recent session entries
\`\`\`text
${truncate(entriesText, 12000)}
\`\`\`

## Verification
- Required section labels are present.
- File is read back from disk after writing.
- SHA256 sidecar is written next to this file.
`;
}

function verifyContent(content: string): void {
  const missing = REQUIRED_SECTIONS.filter((section) => !content.includes(section));
  if (missing.length > 0) throw new Error(`checkpoint missing sections: ${missing.join(", ")}`);
}

function writeCheckpoint(ctx: any): HandoffState {
  ensureDir(HANDOFF_DIR);
  ensureDir(STATE_DIR);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const file = path.join(HANDOFF_DIR, `PI-COMPACT-HANDOFF-${stamp}.md`);
  const content = buildHandoff(ctx);
  verifyContent(content);
  fs.writeFileSync(file, content, "utf8");
  const readBack = fs.readFileSync(file, "utf8");
  verifyContent(readBack);
  const sha256 = crypto.createHash("sha256").update(readBack).digest("hex");
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${path.basename(file)}\n`, "utf8");
  const state: HandoffState = {
    path: file,
    sha256,
    sessionFile: ctx.sessionManager?.getSessionFile?.(),
    createdAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf8");
  return state;
}

function readState(): HandoffState | undefined {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return undefined;
  }
}

function checkpointIsValid(ctx: any): { ok: true; state: HandoffState } | { ok: false; reason: string } {
  const state = readState();
  if (!state) return { ok: false, reason: "no checkpoint state file" };
  if (ctx.sessionManager?.getSessionFile?.() && state.sessionFile && state.sessionFile !== ctx.sessionManager.getSessionFile()) {
    return { ok: false, reason: "checkpoint belongs to a different session" };
  }
  const age = Date.now() - new Date(state.verifiedAt || state.createdAt).getTime();
  if (!Number.isFinite(age) || age > MAX_AGE_MS) return { ok: false, reason: "checkpoint is older than 6 hours" };
  if (!fs.existsSync(state.path)) return { ok: false, reason: "checkpoint file missing" };
  const content = fs.readFileSync(state.path, "utf8");
  verifyContent(content);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  if (sha256 !== state.sha256) return { ok: false, reason: "checkpoint hash mismatch" };
  return { ok: true, state };
}

export default function (pi: any) {
  pi.registerCommand("compact-checkpoint", {
    description: "Write and verify a durable checkpoint before compaction.",
    handler: async (_args: string, ctx: any) => {
      try {
        const state = writeCheckpoint(ctx);
        pi.appendEntry?.("pre-compact-safety", { action: "checkpoint", ...state });
        ctx.ui.notify(`Compact checkpoint written: ${state.path}\nsha256 ${state.sha256}`, "success");
      } catch (error: any) {
        ctx.ui.notify(`Compact checkpoint failed: ${error?.message || String(error)}`, "error");
      }
    },
  });

  pi.on("session_before_compact", async (_event: any, ctx: any) => {
    const result = checkpointIsValid(ctx);
    if (!result.ok) {
      ctx.ui.notify(`Pre-compact safety gate blocked compaction: ${result.reason}. Run /compact-checkpoint first.`, "warning");
      return { cancel: true };
    }
    ctx.ui.notify(`Pre-compact checkpoint verified: ${result.state.path}`, "success");
    return;
  });

  pi.on("session_compact", async (_event: any, ctx: any) => {
    const result = checkpointIsValid(ctx);
    if (result.ok) {
      ctx.ui.notify(`Compaction finished. Verify checkpoint before continuing: ${result.state.path}`, "info");
    } else {
      ctx.ui.notify("Compaction finished, but checkpoint verification failed. Re-read taskQueue.md before continuing.", "warning");
    }
  });
}
