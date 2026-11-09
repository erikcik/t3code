import { describe, expect, it } from "vite-plus/test";

import { extractCeoPrompt } from "./ceoSideChat";

const reply = (text: string, streaming = false) => ({
  role: "assistant" as const,
  text,
  streaming,
});

describe("extractCeoPrompt", () => {
  it("takes the last prompt block of the newest finished reply that has one", () => {
    expect(
      extractCeoPrompt([
        reply("```prompt\nolder\n```"),
        reply("Plan.\n\n```prompt\nfirst\n```\n\n```prompt\nShip the store.\n```\n"),
        reply("No block in this follow-up."),
        reply("```prompt\nstill streaming\n```", true),
      ]),
    ).toBe("Ship the store.");
  });

  it("keeps code fences inside a longer prompt fence", () => {
    expect(extractCeoPrompt([reply("````prompt\nRun:\n```sh\nvp test\n```\n````")])).toBe(
      "Run:\n```sh\nvp test\n```",
    );
  });

  it("ignores other languages and user messages", () => {
    expect(
      extractCeoPrompt([
        { role: "user", text: "```prompt\nmine\n```", streaming: false },
        reply("```ts\nconst a = 1;\n```"),
      ]),
    ).toBeNull();
  });
});
