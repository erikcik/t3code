import { expect, it } from "@effect/vitest";

import { readPiGoalVerdict } from "./goals.ts";

it.each([
  ["Done.\n\nGOAL COMPLETE", { type: "complete" }],
  ["All tests pass.\n**Goal complete.**\n", { type: "complete" }],
  ["GOAL COMPLETE\nThanks for waiting.", { type: "complete" }],
  [
    "GOAL BLOCKED: need the staging password",
    { type: "blocked", reason: "need the staging password" },
  ],
  ["Stuck.\n`GOAL BLOCKED`", { type: "blocked", reason: "Needs your input." }],
  ["I will mark GOAL COMPLETE once the build passes.", { type: "unmet" }],
  ["GOAL COMPLETE\none\ntwo\nthree", { type: "unmet" }],
  ["", { type: "unmet" }],
] as const)("reads the goal verdict of %j", (reply, verdict) => {
  expect(readPiGoalVerdict(reply)).toEqual(verdict);
});
