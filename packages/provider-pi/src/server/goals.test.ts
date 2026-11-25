import { expect, it } from "@effect/vitest";

import { isPiGoalComplete } from "./goals.ts";

it.each([
  ["Done.\n\nGOAL COMPLETE", true],
  ["All tests pass.\n**Goal complete.**\n", true],
  ["GOAL COMPLETE\nThanks for waiting.", true],
  ["I will mark GOAL COMPLETE once the build passes.", false],
  ["GOAL COMPLETE\none\ntwo\nthree", false],
  // Older prompts offered a blocked exit; a reply that still takes it keeps the goal going.
  ["Need a card number.\n\nGOAL BLOCKED: card number", false],
  ["", false],
] as const)("reads whether %j completes the goal", (reply, complete) => {
  expect(isPiGoalComplete(reply)).toBe(complete);
});
