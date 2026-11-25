import type { OrchestrationV2GoalCommand, OrchestrationV2ProviderGoal } from "@t3tools/contracts";

// Pi has no native goals. T3 keeps the goal on the provider thread and re-prompts Pi after each
// settled run until the model ends a reply with one of these markers.
const PI_GOAL_COMPLETE_MARKER = "GOAL COMPLETE";
const PI_GOAL_BLOCKED_MARKER = "GOAL BLOCKED";
/** Bounds what a model that never writes a marker can spend before the goal pauses. */
export const PI_GOAL_MAX_CHECKS = 20;

const GOAL_RULES = [
  "Keep working on your own until the goal is achieved; do not stop to ask for confirmation.",
  `When the goal is fully achieved and verified, end your final message with a line that says exactly: ${PI_GOAL_COMPLETE_MARKER}`,
  `If you cannot make progress without the user, end your final message with a line: ${PI_GOAL_BLOCKED_MARKER}: <what you need>`,
].join("\n");

function piGoalStartPrompt(objective: string): string {
  return `Start working toward this goal: ${objective}\n\n${GOAL_RULES}`;
}

function piGoalResumePrompt(objective: string): string {
  return `Resume working toward this goal: ${objective}\n\n${GOAL_RULES}`;
}

export function piGoalContinuePrompt(objective: string): string {
  return `The goal is not marked complete yet: ${objective}\n\nCheck what is still missing and continue.\n${GOAL_RULES}`;
}

function describePiGoal(goal: OrchestrationV2ProviderGoal): string {
  return `Goal ${goal.status.replace("_", " ")}: ${goal.objective}`;
}

export interface PiGoalCommandResult {
  readonly goal: OrchestrationV2ProviderGoal | null;
  /** Shown as a notice when the command does not start work. */
  readonly reply: string | null;
  /** Sent to Pi when the command starts goal work. */
  readonly prompt: string | null;
}

export function applyPiGoalCommand(
  command: OrchestrationV2GoalCommand,
  current: OrchestrationV2ProviderGoal | null,
): PiGoalCommandResult {
  if (command.type === "set") {
    return {
      goal: { objective: command.objective, status: "active", checks: 0 },
      reply: null,
      prompt: piGoalStartPrompt(command.objective),
    };
  }
  if (current === null) return { goal: null, reply: "No goal is set.", prompt: null };
  switch (command.type) {
    case "show":
      return { goal: current, reply: describePiGoal(current), prompt: null };
    case "clear":
      return { goal: null, reply: `Goal cleared: ${current.objective}`, prompt: null };
    case "pause":
      return { goal: { ...current, status: "paused" }, reply: null, prompt: null };
    case "resume":
      return {
        goal: { objective: current.objective, status: "active", checks: 0 },
        reply: null,
        prompt: piGoalResumePrompt(current.objective),
      };
  }
}

export type PiGoalVerdict =
  | { readonly type: "complete" }
  | { readonly type: "blocked"; readonly reason: string }
  | { readonly type: "unmet" };

/** Reads a marker from the last few lines of the final reply, ignoring markdown decoration. */
export function readPiGoalVerdict(finalReply: string): PiGoalVerdict {
  const lines = finalReply
    .split("\n")
    .map((line) => line.replace(/[*_`#>~]/gu, "").trim())
    .filter((line) => line.length > 0)
    .slice(-3)
    .toReversed();
  for (const line of lines) {
    if (/^goal complete[.!]?$/iu.test(line)) return { type: "complete" };
    const blocked = /^goal blocked\b[\s:.-]*(.*)$/iu.exec(line);
    if (blocked !== null) {
      const reason = blocked[1]?.trim() ?? "";
      return { type: "blocked", reason: reason.length === 0 ? "Needs your input." : reason };
    }
  }
  return { type: "unmet" };
}
