import { EnvironmentId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { countLocalAgentActivity, isThreadWorkingForRestart } from "./restartWhenIdle";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");

type Thread = Parameters<typeof countLocalAgentActivity>[0][number];

function thread(input: {
  readonly status: NonNullable<Thread["runtime"]>["status"] | null;
  readonly activeRunId?: string;
  readonly environmentId?: EnvironmentId;
  readonly background?: number;
  readonly deleted?: boolean;
}): Thread {
  return {
    environmentId: input.environmentId ?? local,
    deletedAt: input.deleted ? "2026-11-12T00:00:00.000Z" : null,
    runtime:
      input.status === null
        ? null
        : ({
            status: input.status,
            activeRunId: input.activeRunId ? RunId.make(input.activeRunId) : null,
          } as Thread["runtime"]),
    pendingBackgroundTasks: Array.from(
      { length: input.background ?? 0 },
      () => ({}) as Thread["pendingBackgroundTasks"][number],
    ),
  };
}

describe("isThreadWorkingForRestart", () => {
  it.each([
    ["preparing", true],
    ["starting", true],
    ["running", true],
    ["waiting", true],
    ["idle", false],
    ["completed", false],
    ["failed", false],
    ["interrupted", false],
  ] as const)("%s -> %s", (status, working) => {
    expect(isThreadWorkingForRestart(thread({ status }))).toBe(working);
  });

  it("waits on a queued run that started, not on a queued message that survives a restart", () => {
    expect(isThreadWorkingForRestart(thread({ status: "queued" }))).toBe(false);
    expect(isThreadWorkingForRestart(thread({ status: "queued", activeRunId: "run-1" }))).toBe(
      true,
    );
  });

  it("ignores threads with no runtime and deleted threads", () => {
    expect(isThreadWorkingForRestart(thread({ status: null }))).toBe(false);
    expect(isThreadWorkingForRestart(thread({ status: "running", deleted: true }))).toBe(false);
  });
});

describe("countLocalAgentActivity", () => {
  it("counts only this machine's threads and reports idle background work separately", () => {
    const activity = countLocalAgentActivity(
      [
        thread({ status: "running" }),
        thread({ status: "waiting", background: 2 }),
        thread({ status: "idle", background: 1 }),
        thread({ status: "idle" }),
        thread({ status: "running", environmentId: remote }),
      ],
      local,
    );
    expect(activity).toEqual({ working: 2, background: 1 });
  });

  it("reports nothing without a local environment", () => {
    expect(countLocalAgentActivity([thread({ status: "running" })], null)).toEqual({
      working: 0,
      background: 0,
    });
  });
});
