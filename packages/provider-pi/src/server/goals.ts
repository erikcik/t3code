import type { OrchestrationV2GoalCommand, OrchestrationV2ProviderGoal } from "@t3tools/contracts";

// Pi has no native goals. T3 keeps the goal on the provider thread and re-prompts Pi after each
// settled run until the model ends a reply with this marker. There is deliberately no "blocked"
// exit: the goal ends only when it is done, paused, cleared or out of checks.
const PI_GOAL_COMPLETE_MARKER = "GOAL COMPLETE";
/** Bounds what a model that never writes the marker can spend before the goal pauses. */
export const PI_GOAL_MAX_CHECKS = 20;

const GOAL_STANCE = [
  "Approach this goal knowing it can be solved. Any problem yields to enough effort, enough parallelism and enough care.",
  "Go down to first principles: what is actually true, what the goal really requires, and which of your assumptions say it cannot be done. Challenge those assumptions and try other routes before you settle on any conclusion.",
  "Split independent work and run it in parallel: concurrent tool calls, and subagents when you have them.",
  "Keep working on your own. Do not stop to ask for confirmation and do not hand the task back.",
  `When the goal is fully achieved and you have verified it, end your final message with a line that says exactly: ${PI_GOAL_COMPLETE_MARKER}`,
].join("\n");

function piGoalStartPrompt(objective: string): string {
  return `Start working toward this goal: ${objective}\n\n${GOAL_STANCE}`;
}

function piGoalResumePrompt(objective: string): string {
  return `Resume working toward this goal: ${objective}\n\n${GOAL_STANCE}`;
}

export function piGoalContinuePrompt(objective: string): string {
  return `The goal is not complete yet: ${objective}\n\nDo not hand it back. Return to first principles: what is still missing, what are you assuming is impossible, and which routes have you not tried yet? Take the most promising ones, run them in parallel where you can, and keep going.\n\n${GOAL_STANCE}`;
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

/** Reads the marker from the last few lines of the final reply, ignoring markdown decoration. */
export function isPiGoalComplete(finalReply: string): boolean {
  return finalReply
    .split("\n")
    .map((line) => line.replace(/[*_`#>~]/gu, "").trim())
    .filter((line) => line.length > 0)
    .slice(-3)
    .some((line) => /^goal complete[.!]?$/iu.test(line));
}
