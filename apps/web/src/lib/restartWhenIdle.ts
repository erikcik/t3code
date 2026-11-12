import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

// A thread often starts its next turn seconds after the last one ends (a queued message, a
// delegate's result, a background task re-invoking it); that gap must not read as idle.
export const RESTART_WHEN_IDLE_QUIET_MS = 20_000;

export interface LocalAgentActivity {
  readonly working: number;
  /** Idle threads whose background command a restart would stop. */
  readonly background: number;
}

type ActivityThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "deletedAt" | "runtime" | "pendingBackgroundTasks"
>;

export function isThreadWorkingForRestart(thread: ActivityThread): boolean {
  if (thread.deletedAt !== null || thread.runtime === null) return false;
  switch (thread.runtime.status) {
    case "preparing":
    case "starting":
    case "running":
    case "waiting":
      return true;
    case "queued":
      // A queued message with no run yet (e.g. waiting out a usage limit) survives a restart.
      return thread.runtime.activeRunId !== null;
    default:
      return false;
  }
}

export function countLocalAgentActivity(
  threads: ReadonlyArray<ActivityThread>,
  environmentId: EnvironmentId | null,
): LocalAgentActivity {
  if (environmentId === null) return { working: 0, background: 0 };
  let working = 0;
  let background = 0;
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    if (isThreadWorkingForRestart(thread)) working += 1;
    else if (thread.deletedAt === null && thread.pendingBackgroundTasks.length > 0) background += 1;
  }
  return { working, background };
}

function agents(count: number): string {
  return count === 1 ? "1 agent" : `${count} agents`;
}

function finish(count: number): string {
  return count === 1 ? "finishes" : "finish";
}

function backgroundNote(background: number): string {
  if (background === 0) return "";
  const threads =
    background === 1 ? "1 idle thread still has" : `${background} idle threads still have`;
  return `\n\n${threads} a background command running. The restart will stop it.`;
}

export function getRestartWhenIdleScheduleMessage(
  version: string | null,
  activity: LocalAgentActivity,
): string {
  const update = version ? `update ${version}` : "the update";
  return (
    `Restart when ${agents(activity.working)} ${finish(activity.working)}?\n\n` +
    `T3 Code will install ${update} and restart on its own once no thread is working, ` +
    `so no agent gets cut off. Click the update button again to restart right away.` +
    backgroundNote(activity.background)
  );
}

export function getRestartNowWhileWaitingMessage(
  version: string | null,
  activity: LocalAgentActivity,
): string {
  return (
    `Restart now and interrupt ${agents(activity.working)}?\n\n` +
    `T3 Code is waiting for ${activity.working === 1 ? "it" : "them"} to finish before it ` +
    `installs${version ? ` ${version}` : " the update"}. Cancel keeps waiting.`
  );
}

export function getRestartWhenIdleTooltip(activity: LocalAgentActivity): string {
  if (activity.working === 0) return "Agents finished. Restarting to install the update…";
  return `Restarting when ${agents(activity.working)} ${finish(activity.working)}. Click to restart now.`;
}

interface RestartWhenIdleState {
  readonly scheduledAt: number | null;
}

export const useRestartWhenIdleStore = create<RestartWhenIdleState>()(() => ({
  scheduledAt: null,
}));

export function scheduleRestartWhenIdle(now = Date.now()): void {
  if (useRestartWhenIdleStore.getState().scheduledAt !== null) return;
  useRestartWhenIdleStore.setState({ scheduledAt: now });
}

export function cancelRestartWhenIdle(): void {
  if (useRestartWhenIdleStore.getState().scheduledAt === null) return;
  useRestartWhenIdleStore.setState({ scheduledAt: null });
}

export function isRestartWhenIdleScheduled(): boolean {
  return useRestartWhenIdleStore.getState().scheduledAt !== null;
}
