import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";

import { type ComposerThreadTarget, useComposerDraftStore } from "../composerDraftStore";
import { toastManager } from "../components/ui/toast";

const OPENED_STORAGE_KEY = "t3code:ceo-side-chats-opened";
const OPENED_LIMIT = 200;

const PROMPT_FENCE = /^(`{3,}|~{3,})prompt[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm;

/** The last `prompt` fenced block in the newest finished assistant reply that has one. */
export function extractCeoPrompt(
  messages: ReadonlyArray<Pick<OrchestrationV2ConversationMessage, "role" | "text" | "streaming">>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "assistant" || message.streaming) continue;
    const prompt = [...message.text.matchAll(PROMPT_FENCE)].at(-1)?.[2]?.trim();
    if (prompt) return prompt;
  }
  return null;
}

let opened: Array<string> | null = null;

function readOpened(): Array<string> {
  if (opened !== null) return opened;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OPENED_STORAGE_KEY) ?? "[]");
    opened = Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
  } catch {
    opened = [];
  }
  return opened;
}

/** CEO side chats open on their own once; after that the user's panel choices stand. */
export function wasCeoSideChatOpened(threadId: string): boolean {
  return readOpened().includes(threadId);
}

export function markCeoSideChatOpened(threadId: string): void {
  opened = [...readOpened().filter((id) => id !== threadId), threadId].slice(-OPENED_LIMIT);
  try {
    localStorage.setItem(OPENED_STORAGE_KEY, JSON.stringify(opened));
  } catch {
    // Storage can be unavailable; the tab then reopens once per page load.
  }
}

/** Puts the CEO's prompt in the main thread's composer, asking before it replaces a draft. */
export function placeCeoPrompt(target: ComposerThreadTarget, prompt: string): void {
  const place = () => {
    useComposerDraftStore.getState().setPrompt(target, prompt);
    toastManager.add({
      type: "info",
      title: "CEO prompt is in the main thread's composer",
      description: "Read it, edit it if needed, then send.",
    });
  };
  const existing = useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";
  if (existing.trim().length === 0 || existing === prompt) {
    place();
    return;
  }
  const id = toastManager.add({
    type: "info",
    title: "The main thread has a draft",
    description: "Replace it with the CEO prompt?",
    timeout: 0,
    actionProps: {
      children: "Replace draft",
      onClick: () => {
        toastManager.close(id);
        place();
      },
    },
  });
}
