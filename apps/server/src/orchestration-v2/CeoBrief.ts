import type { OrchestrationV2ConversationMessage, OrchestrationV2Run } from "@t3tools/contracts";

/** Marks CEO runs in provider transcripts, so a later CEO can skip earlier proposals. */
const CEO_BRIEF_MARKER = "[t3-ceo-brief]";

const TRANSCRIPT_MAX_CHARS = 80_000;
const FIRST_MESSAGE_MAX_CHARS = 8_000;

/**
 * User and assistant messages of runs that were not rolled back, oldest first. Over the cap,
 * the first user message (usually the vision) stays and the oldest of the rest go first.
 */
export function buildCeoTranscript(input: {
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status">>;
  readonly messages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "role" | "text" | "runId" | "streaming">
  >;
}): string {
  const liveRunIds = new Set(
    input.runs.filter((run) => run.status !== "rolled_back").map((run) => run.id),
  );
  const lines = input.messages
    .filter(
      (message) =>
        !message.streaming &&
        message.text.trim().length > 0 &&
        (message.role === "user" || message.role === "assistant") &&
        (message.runId === null || liveRunIds.has(message.runId)),
    )
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text.trim()}`);
  if (lines.length === 0) return "";
  const first = lines[0]!;
  const head =
    first.length > FIRST_MESSAGE_MAX_CHARS
      ? `${first.slice(0, FIRST_MESSAGE_MAX_CHARS)} [...]`
      : first;
  const kept: Array<string> = [];
  let remaining = TRANSCRIPT_MAX_CHARS - head.length;
  let omitted = false;
  for (let index = lines.length - 1; index >= 1; index--) {
    const line = lines[index]!;
    if (line.length + 2 > remaining) {
      omitted = true;
      break;
    }
    kept.unshift(line);
    remaining -= line.length + 2;
  }
  return [head, ...(omitted ? ["[Earlier messages omitted]"] : []), ...kept].join("\n\n");
}

export interface CeoBriefInput {
  readonly contextPath: string;
  readonly projectTitle: string;
  readonly projectRoot: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly threadTitle: string;
  readonly parentThreadId: string;
  readonly excludedSessionIds: ReadonlyArray<string>;
  readonly userInstructions: string | null;
  readonly playbook: string | null;
}

/** The CEO side chat's first message. The user reads it too, so it stays plain. */
export function buildCeoBrief(input: CeoBriefInput): string {
  const workspace =
    input.worktreePath !== null && input.worktreePath !== input.projectRoot
      ? `${input.worktreePath} (worktree of ${input.projectRoot})`
      : input.projectRoot;
  const excluded = [
    `- T3 thread ${input.parentThreadId} (the main thread): do not open it with t3_thread_read or any other T3 tool.`,
    ...input.excludedSessionIds.map(
      (id) => `- Claude Code session ${id}: skip its transcript file (${id}.jsonl).`,
    ),
    `- Any transcript or side chat that contains ${CEO_BRIEF_MARKER}: those are earlier CEO proposals.`,
  ];
  return [
    `${CEO_BRIEF_MARKER} CEO review of "${input.threadTitle}"`,
    "",
    "The main thread just finished a turn. Act as the user's CEO for this project: decide the single next line of action that moves the project toward its ultimate goal, and write the prompt the user will paste into the main thread.",
    "",
    "## Your view of the main thread",
    `Read ${input.contextPath} first, completely. It is a cleaned record of the main thread: goals, what was done, current state, open problems. Every suggestion about what to do next was removed on purpose, so your answer comes from your own judgment, not from the main thread's ideas.`,
    "Off limits, because they still carry those suggestions:",
    ...excluded,
    "",
    "## Project",
    `- Name: ${input.projectTitle}`,
    `- Workspace: ${workspace}`,
    ...(input.branch === null ? [] : [`- Branch: ${input.branch}`]),
    "",
    ...(input.playbook === null
      ? []
      : [
          "## The user's playbook for CEOs",
          "Rules distilled from the user's own feedback on earlier CEO proposals. They outrank your defaults; follow every one that applies.",
          input.playbook,
          "",
        ]),
    "## Research before you decide",
    "Use every source on this machine that tells you about the user, the project, and how the user decides:",
    "- The project itself, read-only: README, CLAUDE.md or AGENTS.md, docs, plans, recent git history and the working tree's current state.",
    "- Your loaded instructions (global and project CLAUDE.md). They point to the user's knowledge base, memory and conventions; follow those pointers.",
    "- Claude Code memory under ~/.claude/projects/*/memory/, and past Claude Code transcripts (~/.claude/projects/*/*.jsonl) about this project or similar decisions: what the user asked for, accepted, rejected and corrected.",
    "- Other T3 threads in this project (t3_thread_search, t3_thread_list), except the main thread.",
    "- Connected tools such as Notion, when they hold the user's plans, journals or decisions.",
    "Use subagents for wide searches and keep the conclusions, not the dumps. Note where each key fact came from.",
    "",
    "## Rules",
    "- Stay read-only: change no files, make no commits, push nothing, send no messages, create no accounts. The main thread may still be working in this workspace.",
    "- Pick one direction. Weigh two or three real alternatives, then commit.",
    "- Ground the choice in the project's final goal and the user's past decisions, not in what is easiest next.",
    "- Write the final prompt in the language the user writes in the main thread.",
    "",
    "## Answer in this shape",
    "1. **Where it stands**: 3 to 5 bullets.",
    "2. **Ultimate goal**: one or two sentences, with the source.",
    "3. **Next line of action**: what and why, citing the evidence and the user's past decisions.",
    "4. **Considered and rejected**: one line each.",
    "5. **Prompt for the main thread**: one fenced block marked `prompt` (open it with four backticks when the prompt itself contains code fences), self-contained, with the goal, concrete steps, constraints and how to verify it is done.",
    "",
    "The user may ask follow-up questions or judge your proposal here. Their judgments are recorded and turned into playbook rules for future CEOs. When they criticize it, take the point fully, revise, and end with the full updated prompt block.",
    ...(input.userInstructions === null
      ? []
      : ["", "## Standing instructions from the user", input.userInstructions]),
  ].join("\n");
}
