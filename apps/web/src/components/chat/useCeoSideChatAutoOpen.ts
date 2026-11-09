import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { markCeoSideChatOpened, wasCeoSideChatOpened } from "../../lib/ceoSideChat";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { useSideChats } from "../../state/entities";

/** Shows the newest CEO side chat the server started, once, and drops tabs of replaced ones. */
export function useCeoSideChatAutoOpen(threadRef: ScopedThreadRef | null) {
  const sideChats = useSideChats(threadRef);
  const ceoChats = sideChats.filter((thread) => thread.lineage.ceo === true);
  const newest = ceoChats.reduce<(typeof ceoChats)[number] | null>(
    (latest, thread) =>
      latest === null || Date.parse(thread.createdAt) > Date.parse(latest.createdAt)
        ? thread
        : latest,
    null,
  );
  const target = newest !== null && !wasCeoSideChatOpened(newest.id) ? newest.id : null;
  const liveIds = ceoChats.map((thread) => thread.id).join("\n");
  const environmentId = threadRef?.environmentId;
  const threadId = threadRef?.threadId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens a tab the server's CEO review created, in the persisted panel store
  useEffect(() => {
    if (environmentId === undefined || threadId === undefined || target === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    markCeoSideChatOpened(target);
    const store = useRightPanelStore.getState();
    const live = new Set(liveIds.split("\n"));
    for (const surface of selectThreadRightPanelState(store.byThreadKey, ref).surfaces) {
      if (
        surface.kind === "side-chat" &&
        surface.threadId.startsWith("ceo:") &&
        !live.has(surface.threadId)
      ) {
        store.closeSurface(ref, surface.id);
      }
    }
    store.openSideChat(ref, target);
  }, [environmentId, threadId, target, liveIds]);
}
