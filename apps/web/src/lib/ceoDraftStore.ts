import { CEO_THREAD_TAG } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./storage";

const DRAFT_LIMIT = 100;

interface CeoDraftState {
  /** Draft thread ids with CEO review on; the tag is set once the draft becomes a thread. */
  readonly threadIds: ReadonlyArray<string>;
  readonly setCeoDraft: (threadId: string, on: boolean) => void;
}

export const useCeoDraftStore = create<CeoDraftState>()(
  persist(
    (set) => ({
      threadIds: [],
      setCeoDraft: (threadId, on) =>
        set((state) => {
          const others = state.threadIds.filter((id) => id !== threadId);
          return { threadIds: on ? [...others, threadId].slice(-DRAFT_LIMIT) : others };
        }),
    }),
    {
      name: "t3code:ceo-drafts",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ threadIds: state.threadIds }),
    },
  ),
);

/** The tags a draft's new thread starts with, as `createThread.tags` takes them. */
export function ceoDraftTags(threadId: string): { readonly tags?: ReadonlyArray<string> } {
  return useCeoDraftStore.getState().threadIds.includes(threadId) ? { tags: [CEO_THREAD_TAG] } : {};
}
