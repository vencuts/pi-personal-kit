/**
 * review-loop-budget — hard limit on autonomous review loops.
 *
 * Born after an unattended overnight session spawned 24 "final" review pairs
 * (49 agents) and burned several hundred dollars. Hence a hard limit.
 *
 * Two guards on `team_spawn` and `subagent` tool calls:
 *
 * 1. REVIEW ROUND BUDGET — review-classified spawns are grouped into rounds
 *    (spawns within 5 min of the previous review spawn = same round). Round
 *    3+ is hard-blocked. `/review-budget allow` grants one extra round.
 *
 * 2. STALE INPUT GUARD — any spawn is blocked when the last human input is
 *    older than 90 minutes (see staleInputMs). Kills the "no unattended multi-hour runs" case:
 *    the model must stop, summarize, and wait for the user.
 *
 * Commands: /review-budget [status|allow|reset]
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_REVIEW_ROUNDS = 2;
const ROUND_BATCH_WINDOW_MS = 5 * 60 * 1000; // spawns within 5 min = same round
const DEFAULT_STALE_INPUT_MS = 90 * 60 * 1000; // block all spawns after 90 min without human input
// Optional time-boxed override for a long attended session: set both values, and the
// default returns on its own once TEMP_STALE_INPUT_UNTIL has passed. Disabled by default.
const TEMP_STALE_INPUT_MS = DEFAULT_STALE_INPUT_MS;
const TEMP_STALE_INPUT_UNTIL = 0;
export function staleInputMs(now: number = Date.now()): number {
  return now < TEMP_STALE_INPUT_UNTIL ? TEMP_STALE_INPUT_MS : DEFAULT_STALE_INPUT_MS;
}
// Optional time-boxed extra review rounds, encoded here so a /reload does not wipe an
// in-memory grant. Same expiry as the stale-input override. Disabled by default.
const TEMP_EXTRA_REVIEW_ROUNDS = 0;
export function tempExtraReviewRounds(now: number = Date.now()): number {
  return now < TEMP_STALE_INPUT_UNTIL ? TEMP_EXTRA_REVIEW_ROUNDS : 0;
}

const REVIEW_PATTERN =
  /(review|adversar|security|audit|red[-_ ]?team|ship[-_ ]?gate|verdict|critic|challenger|inspect(or|ion)|scrutin)/i;

export function isReviewSpawn(text: string): boolean {
  return REVIEW_PATTERN.test(text);
}

export function spawnText(toolName: string, input: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
  };
  push(input.name);
  push(input.task);
  push(input.agent);
  for (const item of Array.isArray(input.tasks) ? input.tasks : []) {
    if (item && typeof item === "object") {
      push((item as Record<string, unknown>).agent);
      push((item as Record<string, unknown>).task);
    }
  }
  for (const item of Array.isArray(input.chain) ? input.chain : []) {
    if (item && typeof item === "object") {
      push((item as Record<string, unknown>).agent);
      push((item as Record<string, unknown>).task);
    }
  }
  return parts.join(" ");
}

interface BudgetState {
  reviewRounds: number;
  extraRoundsGranted: number;
  lastReviewSpawnAt: number | null;
  lastHumanInputAt: number;
  blockedCount: number;
}

export default function (pi: ExtensionAPI) {
  const state: BudgetState = {
    reviewRounds: 0,
    extraRoundsGranted: 0,
    lastReviewSpawnAt: null,
    lastHumanInputAt: Date.now(),
    blockedCount: 0,
  };

  const limit = () => MAX_REVIEW_ROUNDS + state.extraRoundsGranted + tempExtraReviewRounds();

  function statusLine(): string {
    return `review rounds ${state.reviewRounds}/${limit()} · blocked ${state.blockedCount}`;
  }

  pi.on("session_start", async (_event, ctx) => {
    state.lastHumanInputAt = Date.now();
    if (ctx.hasUI) ctx.ui.setStatus("review-budget", statusLine());
  });

  pi.on("input", async (event, _ctx) => {
    // Only human input resets the unattended clock. Extension-injected
    // messages (mailbox batches, follow-ups) do not count.
    if (event.source !== "extension") {
      state.lastHumanInputAt = Date.now();
    }
    return { action: "continue" };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "team_spawn" && event.toolName !== "subagent") return;
    const input = (event.input ?? {}) as Record<string, unknown>;
    const text = spawnText(event.toolName, input);
    const now = Date.now();

    // Guard 2: stale human input — no unattended multi-hour spawn chains.
    const sinceInputMs = now - state.lastHumanInputAt;
    const staleLimitMs = staleInputMs(now);
    if (sinceInputMs > staleLimitMs) {
      state.blockedCount++;
      if (ctx.hasUI) ctx.ui.setStatus("review-budget", statusLine());
      const mins = Math.round(sinceInputMs / 60000);
      return {
        block: true,
        reason:
          `review-loop-budget: BLOCKED — last human input was ${mins} minutes ago (limit ${Math.round(staleLimitMs / 60000)}). ` +
          `Unattended agent spawning is not allowed. Stop, summarize current findings and ` +
          `state, and wait for the user's next instruction.`,
      };
    }

    // Guard 1: review round budget.
    if (!isReviewSpawn(text)) return;
    const newRound =
      state.lastReviewSpawnAt === null || now - state.lastReviewSpawnAt > ROUND_BATCH_WINDOW_MS;
    if (newRound && state.reviewRounds >= limit()) {
      state.blockedCount++;
      if (ctx.hasUI) ctx.ui.setStatus("review-budget", statusLine());
      return {
        block: true,
        reason:
          `review-loop-budget: BLOCKED — review round ${state.reviewRounds + 1} exceeds the ` +
          `hard limit of ${limit()} review rounds per session. Two convergent review verdicts ` +
          `are enough. Fix the known findings yourself, present the result to the user, and let ` +
          `them decide whether another round is worth it (they can grant one with /review-budget allow).`,
      };
    }
    if (newRound) state.reviewRounds++;
    state.lastReviewSpawnAt = now;
    if (ctx.hasUI) ctx.ui.setStatus("review-budget", statusLine());
  });

  pi.registerCommand("review-budget", {
    description: "Review-loop budget: status | allow (grant +1 round) | reset",
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim().toLowerCase();
      if (arg === "allow") {
        state.extraRoundsGranted++;
        ctx.ui.notify(`Granted one extra review round (${state.reviewRounds}/${limit()}).`, "info");
      } else if (arg === "reset") {
        state.reviewRounds = 0;
        state.extraRoundsGranted = 0;
        state.lastReviewSpawnAt = null;
        state.blockedCount = 0;
        ctx.ui.notify("Review budget reset.", "info");
      } else {
        const mins = Math.round((Date.now() - state.lastHumanInputAt) / 60000);
        ctx.ui.notify(`${statusLine()} · last human input ${mins}m ago`, "info");
      }
      if (ctx.hasUI) ctx.ui.setStatus("review-budget", statusLine());
    },
  });
}
