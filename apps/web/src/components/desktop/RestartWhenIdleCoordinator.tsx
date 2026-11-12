import { useEffect } from "react";

import {
  cancelRestartWhenIdle,
  isRestartWhenIdleScheduled,
  RESTART_WHEN_IDLE_QUIET_MS,
  useRestartWhenIdleStore,
} from "../../lib/restartWhenIdle";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { useLocalAgentActivity } from "../desktopUpdate.restartWhenIdle";
import { installLocalUpdate } from "../sidebar/SidebarUpdatePill";
import { toastManager } from "../ui/toast";

export function RestartWhenIdleCoordinator() {
  const scheduled = useRestartWhenIdleStore((state) => state.scheduledAt !== null);
  return scheduled ? <RestartWhenIdleWatcher /> : null;
}

function RestartWhenIdleWatcher() {
  const { working } = useLocalAgentActivity(true);
  const updateState = useDesktopUpdateState();
  const downloadedVersion = updateState?.downloadedVersion ?? null;
  const downloadGone =
    updateState !== null && downloadedVersion === null && updateState.status !== "downloading";

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer until the app restarts; any new turn resets it
  useEffect(() => {
    if (downloadGone) {
      cancelRestartWhenIdle();
      return;
    }
    const bridge = window.desktopBridge;
    if (working > 0 || downloadedVersion === null || !bridge) return;
    const timer = setTimeout(() => {
      if (!isRestartWhenIdleScheduled()) return;
      cancelRestartWhenIdle();
      toastManager.add({
        type: "info",
        title: "Agents finished",
        description: `Restarting to install ${downloadedVersion}.`,
      });
      void installLocalUpdate(bridge, undefined, downloadedVersion);
    }, RESTART_WHEN_IDLE_QUIET_MS);
    return () => clearTimeout(timer);
  }, [working, downloadedVersion, downloadGone]);

  return null;
}
