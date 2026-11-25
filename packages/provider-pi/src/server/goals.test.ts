import { expect, it } from "@effect/vitest";

import { applyPiGoalCommand, parsePiGoalVerdict, piGoalTranscript } from "./goals.ts";

it.each([
  ['{"ok": true, "reason": "tests pass"}', { ok: true, reason: "tests pass", impossible: false }],
  [
    '```json\n{"ok": false, "reason": "no output", "impossible": true}\n```',
    { ok: false, reason: "no output", impossible: true },
  ],
  [
    'Verdict: {"ok": true, "reason": "done", "impossible": true} as requested',
    { ok: true, reason: "done", impossible: false },
  ],
  ['{"ok": "yes", "reason": "done"}', null],
  ["The goal is met.", null],
] as const)("reads the evaluator verdict from %j", (reply, verdict) => {
  expect(parsePiGoalVerdict(reply)).toEqual(verdict);
});

it.each([
  [{ type: "set", objective: "Stop" } as const, { goal: null, reply: "Goal cleared: old" }],
  [
    { type: "set", objective: "x".repeat(4001) } as const,
    {
      goal: { objective: "old", status: "active" },
      reply: "Goal condition is limited to 4000 characters (got 4001)",
    },
  ],
] as const)("applies %j like Claude Code", (command, expected) => {
  const result = applyPiGoalCommand(command, { objective: "old", status: "active" });
  expect({ goal: result.goal, reply: result.reply }).toEqual(expected);
  expect(result.prompt).toBeNull();
});

it("keeps the newest transcript messages and says how many were dropped", () => {
  const message = (text: string) => ({ role: "user", content: text });
  const transcript = piGoalTranscript([message("a".repeat(50)), message("recent")], 30);
  expect(transcript).toContain("1 earlier messages omitted");
  expect(transcript.endsWith("[user]\nrecent")).toBe(true);
});
