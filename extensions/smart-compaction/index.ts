/**
 * Smart Compaction Extension
 *
 * Enhances Pi's default compaction by preserving high-value context that the
 * generic summarizer loses. It now also fails closed: every compaction must
 * first write durable handoff artifacts outside the session context.
 *
 * Preserves:
 * - Decision IDs (D1, D253, etc.) with their status
 * - User corrections ("<user> caught/flagged/said ...")
 * - Fully-qualified warehouse table names (project.dataset.table)
 * - Slack permalinks / thread URLs
 * - GitHub PR URLs, issue IDs, and commit SHAs
 * - Local file paths and world paths
 * - Iron law claims from recent deliverables
 * - Decision statuses (LOCKED, PENDING, SUPERSEDED)
 *
 * SAFETY: If durable handoff write fails, compaction is cancelled. This avoids
 * losing crucial context silently. If the enhanced LLM summary fails after the
 * handoff is written, default compaction can still run because the raw handoff
 * exists on disk.
 *
 * Configure the user name via SMART_COMPACTION_USER (defaults to "the user").
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

// Patterns to extract from messages before they get summarized.
const DECISION_PATTERN = /\bD\d{1,4}\b/g;
const USER_NAME = process.env.SMART_COMPACTION_USER || "the user";
const TABLE_PATTERN = /`?[a-z][a-z0-9-]{3,}\.[a-z_][\w]*\.[a-z_][\w]*`?/g;
const CORRECTION_PATTERN = new RegExp(`(?:${USER_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:caught|correction|flagged|said)|W\\d{1,2}\\s+(?:correction|feedback))[^.]*\\.`, "gi");
const IRON_LAW_PATTERN = /iron[_\s-]?law[^.]*\d+\/\d+/gi;
const STATUS_PATTERN = /\b(?:LOCKED|PENDING|SUPERSEDED|SETTLED|CONFIRMED|DEFERRED|MERGED|SHIPPED|BLOCKED|WAIVED)\b/g;
const SLACK_URL_PATTERN = /https:\/\/[\w-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+(?:\?thread_ts=[\d.]+)?/g;
const GITHUB_URL_PATTERN = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+/g;
const GRAPHITE_URL_PATTERN = /https:\/\/app\.graphite\.dev\/github\/pr\/[\w.-]+\/[\w.-]+\/\d+/g;
const COMMIT_PATTERN = /\b[0-9a-f]{7,40}\b/g;
const FILE_PATH_PATTERN = /(?:(?:~|\/Users\/[\w.-]+|\/home\/[\w.-]+)\/[\w.\- /@]+|\/tmp\/[\w.\- /@]+|\/\/[\w.\-/@]+|[\w.-]+\/[\w.\-/@]+\.(?:md|ts|tsx|js|json|yml|yaml|sql|rb|py|html|css))\b/g;
const TASK_MARKER_PATTERN = /(?:^|\n)\s*(?:[-*]\s+)?(?:\d+\.\s+)?\[[ xX]\]\s+[^\n]+/g;

interface PreservationItems {
  decisions: string[];
  tables: string[];
  corrections: string[];
  ironLaw: string[];
  statuses: string[];
  slackUrls: string[];
  githubUrls: string[];
  graphiteUrls: string[];
  commits: string[];
  filePaths: string[];
  taskMarkers: string[];
}

interface HandoffArtifacts {
  markdownPath: string;
  rawJsonPath: string;
  rawTextPath: string;
}

function uniqueMatches(text: string, pattern: RegExp, limit = 100): string[] {
  return [...new Set(text.match(pattern) || [])]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function extractPreservationItems(text: string): PreservationItems {
  return {
    decisions: uniqueMatches(text, DECISION_PATTERN, 100),
    tables: uniqueMatches(text, TABLE_PATTERN, 50),
    corrections: uniqueMatches(text, CORRECTION_PATTERN, 20),
    ironLaw: uniqueMatches(text, IRON_LAW_PATTERN, 20),
    statuses: uniqueMatches(text, STATUS_PATTERN, 100),
    slackUrls: uniqueMatches(text, SLACK_URL_PATTERN, 100),
    githubUrls: uniqueMatches(text, GITHUB_URL_PATTERN, 100),
    graphiteUrls: uniqueMatches(text, GRAPHITE_URL_PATTERN, 100),
    commits: uniqueMatches(text, COMMIT_PATTERN, 100),
    filePaths: uniqueMatches(text, FILE_PATH_PATTERN, 150),
    taskMarkers: uniqueMatches(text, TASK_MARKER_PATTERN, 80),
  };
}

function buildList(title: string, values: string[], limit = 25): string {
  if (values.length === 0) return `### ${title}\n- None found\n`;
  const shown = values.slice(0, limit).map((value) => `- ${value}`).join("\n");
  const hidden = values.length > limit ? `\n- ... ${values.length - limit} more in raw handoff` : "";
  return `### ${title}\n${shown}${hidden}\n`;
}

function buildPreservationBlock(items: PreservationItems, artifacts?: HandoffArtifacts): string {
  const parts: string[] = [];

  if (artifacts) {
    parts.push(`**Durable pre-compact handoff**: ${artifacts.markdownPath}`);
    parts.push(`**Raw compacted messages JSON**: ${artifacts.rawJsonPath}`);
    parts.push(`**Serialized conversation text**: ${artifacts.rawTextPath}`);
  }
  if (items.decisions.length > 0) {
    parts.push(`**Decisions referenced**: ${items.decisions.join(", ")}`);
  }
  if (items.tables.length > 0) {
    parts.push(`**BQ tables used**: ${items.tables.slice(0, 25).join(", ")}`);
  }
  if (items.slackUrls.length > 0) {
    parts.push(`**Slack URLs**: ${items.slackUrls.slice(0, 15).join(" | ")}`);
  }
  if (items.githubUrls.length > 0 || items.graphiteUrls.length > 0) {
    parts.push(`**PR/issue URLs**: ${[...items.githubUrls, ...items.graphiteUrls].slice(0, 15).join(" | ")}`);
  }
  if (items.corrections.length > 0) {
    parts.push(`**Corrections from ${USER_NAME}**: ${items.corrections.slice(0, 10).join(" | ")}`);
  }
  if (items.ironLaw.length > 0) {
    parts.push(`**Iron law checks**: ${items.ironLaw.join("; ")}`);
  }

  if (parts.length === 0) return "";

  return `\n\n## Preserved Context (smart-compaction safety gate)\n${parts.join("\n")}`;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, innerValue) => {
      if (typeof innerValue === "bigint") return innerValue.toString();
      if (typeof innerValue === "object" && innerValue !== null) {
        if (seen.has(innerValue)) return "[Circular]";
        seen.add(innerValue);
      }
      return innerValue;
    },
    2,
  );
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeDurableHandoff(params: {
  allMessages: unknown[];
  conversationText: string;
  items: PreservationItems;
  tokensBefore: number;
  firstKeptEntryId: string;
  previousSummary?: string;
  settings: unknown;
}): Promise<HandoffArtifacts> {
  const dir = join(homedir(), ".pi", "memory", "history", "compaction-handoffs", new Date().toISOString().slice(0, 10));
  await mkdir(dir, { recursive: true });

  const stamp = timestampForPath();
  const base = join(dir, `${stamp}-${params.tokensBefore}-tokens`);
  const markdownPath = `${base}.md`;
  const rawJsonPath = `${base}.raw.json`;
  const rawTextPath = `${base}.conversation.txt`;

  const markdown = `# Pre-compact Safety Handoff — ${new Date().toISOString()}

> Generated by smart-compaction safety gate before Pi compaction. This file is the durable source of truth if the compaction summary drops details.

## Compaction Metadata
- Tokens before: ${params.tokensBefore}
- First kept entry ID: ${params.firstKeptEntryId}
- Settings: \`${JSON.stringify(params.settings)}\`
- Raw messages JSON: \`${rawJsonPath}\`
- Serialized conversation text: \`${rawTextPath}\`

## Previous Summary
${params.previousSummary ? params.previousSummary : "None"}

## Must-Preserve Receipts

${buildList("Slack URLs", params.items.slackUrls, 50)}
${buildList("GitHub URLs", params.items.githubUrls, 50)}
${buildList("Graphite URLs", params.items.graphiteUrls, 50)}
${buildList("Commit SHAs", params.items.commits, 50)}
${buildList("Decision IDs", params.items.decisions, 100)}
${buildList("BQ Tables", params.items.tables, 50)}
${buildList("File Paths", params.items.filePaths, 80)}
${buildList("Task Markers", params.items.taskMarkers, 80)}
${buildList("Corrections", params.items.corrections, 20)}
${buildList("Iron Law Checks", params.items.ironLaw, 20)}
${buildList("Statuses", params.items.statuses, 80)}

## Resume Rule
Before continuing after this compaction, read this handoff and verify the current task still matches the latest taskQueue/dailyContext state.
`;

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(rawJsonPath, safeStringify(params.allMessages), "utf8");
  await writeFile(rawTextPath, params.conversationText, "utf8");

  return { markdownPath, rawJsonPath, rawTextPath };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation } = event;
    const { messagesToSummarize, turnPrefixMessages } = preparation;

    // Combine all messages being compacted. Even small compactions get a durable
    // checkpoint because crucial context has been lost during compaction before.
    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];

    // Fail closed if Pi hands us an empty compaction payload. This prevents
    // empty raw handoffs and fake summaries like "conversation content remains empty."
    if (allMessages.length === 0) {
      ctx.ui.notify(
        "Compaction cancelled: empty compaction payload. Check compaction settings before retrying.",
        "error",
      );
      return { cancel: true };
    }

    const conversationText = serializeConversation(convertToLlm(allMessages));
    const items = extractPreservationItems(conversationText);

    let artifacts: HandoffArtifacts;
    try {
      artifacts = await writeDurableHandoff({
        allMessages,
        conversationText,
        items,
        tokensBefore: preparation.tokensBefore,
        firstKeptEntryId: preparation.firstKeptEntryId,
        previousSummary: preparation.previousSummary,
        settings: preparation.settings,
      });
      ctx.ui.notify(`Pre-compact handoff written: ${artifacts.markdownPath}`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Compaction cancelled: durable handoff write failed (${message})`, "error");
      return { cancel: true };
    }

    // If nothing worth preserving was detected, allow default compaction to run.
    // The durable handoff still exists as the lossless checkpoint.
    const totalItems = Object.values(items).reduce((count, values) => count + values.length, 0);
    if (totalItems === 0) return;

    const preservationBlock = buildPreservationBlock(items, artifacts);

    const model = ctx.model;
    if (!model) return;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return;

    const previousContext = preparation.previousSummary
      ? `\n\nPrevious summary:\n${preparation.previousSummary}`
      : "";

    const summaryMessages = [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `You are summarizing a work session. Create a structured summary following this EXACT format:

## Goal
[What the user is working on]

## Constraints & Preferences
- [Key rules, voice preferences, behavioral patterns]

## Progress
### Done
- [x] [Completed items — be specific, include file paths and decision numbers]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress]

## Key Decisions
- **[Decision ID]**: [What was decided, current status]

## Next Steps
1. [What should happen next]

## Critical Context
- [Anything the next turn NEEDS to continue working]
- Durable pre-compact handoff: ${artifacts.markdownPath}

MANDATORY PRESERVATION RULES:
- Preserve ALL decision references (D1, D253, etc.) with their status (LOCKED/PENDING/SUPERSEDED)
- Preserve ALL fully-qualified warehouse table names verbatim (project.dataset.table)
- Preserve ALL Slack permalinks, PR URLs, commit SHAs, and local file paths verbatim
- Preserve ALL corrections from the user with the exact quote
- Preserve iron law claim counts (e.g., "iron law 9/9")
- Do NOT generalize specific numbers, table names, URLs, file paths, or decision IDs into vague summaries
- When a decision status changed (e.g., D235 SUPERSEDED by D238), include BOTH the old and new
- State that raw compacted messages were saved at ${artifacts.rawJsonPath}

${previousContext}

<conversation>
${conversationText}
</conversation>`,
          },
        ],
        timestamp: Date.now(),
      },
    ];

    try {
      const { complete } = await import("@mariozechner/pi-ai");

      const response = await complete(
        model,
        { messages: summaryMessages },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 8192,
          signal: event.signal,
        },
      );

      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      if (!summary.trim()) return;

      return {
        compaction: {
          summary: summary + preservationBlock,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          details: {
            preservedDecisions: items.decisions,
            preservedTables: items.tables,
            preservedSlackUrls: items.slackUrls,
            preservedGithubUrls: items.githubUrls,
            preservedCommits: items.commits,
            handoffPath: artifacts.markdownPath,
            rawJsonPath: artifacts.rawJsonPath,
            rawTextPath: artifacts.rawTextPath,
            source: "smart-compaction-safety-gate-v2",
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Enhanced compaction failed after handoff write; using default compaction (${message})`, "warning");
      return;
    }
  });
}
