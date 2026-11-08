import { useEffect } from "react";
import { create } from "zustand";

interface DraftProjectPickerState {
  readonly openKey: string | null;
}

/** Lives outside the hero so `chat.pickProject` can open a draft's picker before it renders. */
export const useDraftProjectPickerStore = create<DraftProjectPickerState>()(() => ({
  openKey: null,
}));

// Counted so StrictMode's remount does not read as the hero leaving.
const mountedHeroes = new Map<string, number>();

// A request for a hero that never shows must not open it on a later visit.
const UNCLAIMED_REQUEST_TIMEOUT_MS = 2_000;

export function setDraftProjectPickerOpen(key: string, open: boolean): void {
  const { openKey } = useDraftProjectPickerStore.getState();
  if (open ? openKey === key : openKey !== key) return;
  useDraftProjectPickerStore.setState({ openKey: open ? key : null });
}

export function toggleDraftProjectPicker(key: string): void {
  setDraftProjectPickerOpen(key, useDraftProjectPickerStore.getState().openKey !== key);
}

/** Opens the picker of a draft that may still be rendering. */
export function requestDraftProjectPicker(key: string): void {
  setDraftProjectPickerOpen(key, true);
  setTimeout(() => {
    if (!mountedHeroes.has(key)) setDraftProjectPickerOpen(key, false);
  }, UNCLAIMED_REQUEST_TIMEOUT_MS);
}

export function isDraftProjectPickerOpen(): boolean {
  return useDraftProjectPickerStore.getState().openKey !== null;
}

export function isDraftProjectPickerShowing(key: string): boolean {
  return mountedHeroes.has(key);
}

/** The picker's open state for one hero. A hero that unmounts while open closes its picker. */
export function useDraftProjectPickerOpen(
  key: string,
): readonly [boolean, (open: boolean) => void] {
  const open = useDraftProjectPickerStore((state) => state.openKey === key);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks which heroes are showing so a picker closes when its hero leaves; the close is deferred so StrictMode's remount keeps it open
  useEffect(() => {
    mountedHeroes.set(key, (mountedHeroes.get(key) ?? 0) + 1);
    return () => {
      const remaining = (mountedHeroes.get(key) ?? 1) - 1;
      if (remaining > 0) mountedHeroes.set(key, remaining);
      else mountedHeroes.delete(key);
      queueMicrotask(() => {
        if (!mountedHeroes.has(key)) setDraftProjectPickerOpen(key, false);
      });
    };
  }, [key]);
  return [open, (next: boolean) => setDraftProjectPickerOpen(key, next)];
}
