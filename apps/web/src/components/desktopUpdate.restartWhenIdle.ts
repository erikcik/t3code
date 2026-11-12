import type { DesktopUpdateState } from "@t3tools/contracts";

import {
  cancelRestartWhenIdle,
  countLocalAgentActivity,
  getRestartNowWhileWaitingMessage,
  getRestartWhenIdleScheduleMessage,
  isRestartWhenIdleScheduled,
  type LocalAgentActivity,
  scheduleRestartWhenIdle,
} from "../lib/restartWhenIdle";
import { ensureLocalApi } from "../localApi";
import { readThreadShells, useThreadShells } from "../state/entities";
import { readPrimaryEnvironmentId, usePrimaryEnvironmentId } from "../state/environments";
import { getDesktopUpdateInstallConfirmationMessage } from "./desktopUpdate.logic";
import { toastManager } from "./ui/toast";

/** Pass `enabled: false` where the count is not shown, so shell changes do not re-render. */
export function useLocalAgentActivity(enabled: boolean): LocalAgentActivity {
  const threads = useThreadShells(enabled);
  const environmentId = usePrimaryEnvironmentId();
  return countLocalAgentActivity(threads, environmentId);
}

function readLocalAgentActivity(): LocalAgentActivity {
  return countLocalAgentActivity(readThreadShells(), readPrimaryEnvironmentId());
}

function showRestartWaitingToast(version: string | null): void {
  const id = toastManager.add({
    type: "info",
    title: "Restart scheduled",
    description: `T3 Code will install ${version ?? "the update"} once no agent is working.`,
    actionProps: {
      children: "Stop waiting",
      onClick: () => {
        toastManager.close(id);
        cancelRestartWhenIdle();
      },
    },
  });
}

/** For flows the user already confirmed: installs now, or waits for working agents to finish. */
export async function installLocalUpdateWhenIdle(
  version: string | null,
  install: () => Promise<boolean>,
): Promise<boolean> {
  if (readLocalAgentActivity().working === 0) return install();
  scheduleRestartWhenIdle();
  showRestartWaitingToast(version);
  return false;
}

/**
 * The one way a user installs a downloaded update: with agents working it schedules the restart
 * for when they finish instead of interrupting them. Rejects when the dialog cannot open.
 */
export async function requestLocalUpdateInstall(input: {
  readonly state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">;
  readonly install: () => Promise<unknown>;
}): Promise<void> {
  const version = input.state.downloadedVersion ?? input.state.availableVersion;
  const activity = readLocalAgentActivity();
  const { confirm } = ensureLocalApi().dialogs;

  if (isRestartWhenIdleScheduled()) {
    if (
      activity.working > 0 &&
      !(await confirm(getRestartNowWhileWaitingMessage(version, activity), {
        variant: "destructive",
      }))
    ) {
      showRestartWaitingToast(version);
      return;
    }
    cancelRestartWhenIdle();
    await input.install();
    return;
  }

  if (activity.working > 0) {
    if (!(await confirm(getRestartWhenIdleScheduleMessage(version, activity)))) return;
    scheduleRestartWhenIdle();
    showRestartWaitingToast(version);
    return;
  }

  if (await confirm(getDesktopUpdateInstallConfirmationMessage(input.state))) {
    await input.install();
  }
}
