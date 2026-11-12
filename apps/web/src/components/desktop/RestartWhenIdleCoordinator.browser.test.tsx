import type { DesktopBridge } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let working = 0;
  return {
    installLocalUpdate: vi.fn(async () => true),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getWorking: () => working,
    setWorking: (next: number) => {
      working = next;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock(import("../desktopUpdate.restartWhenIdle"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original()),
    useLocalAgentActivity: () => ({
      working: useSyncExternalStore(mocks.subscribe, mocks.getWorking),
      background: 0,
    }),
  };
});
vi.mock(import("../../state/desktopUpdate"), async (original) => ({
  ...(await original()),
  useDesktopUpdateState: () =>
    ({ status: "downloaded", downloadedVersion: "9.9.9" }) as ReturnType<
      typeof import("../../state/desktopUpdate").useDesktopUpdateState
    >,
}));
vi.mock(import("../sidebar/SidebarUpdatePill"), () => ({
  installLocalUpdate: mocks.installLocalUpdate,
}));

import { act, fakeTimers, render, stubGlobal } from "../../../test/render";
import {
  cancelRestartWhenIdle,
  isRestartWhenIdleScheduled,
  RESTART_WHEN_IDLE_QUIET_MS,
  scheduleRestartWhenIdle,
} from "../../lib/restartWhenIdle";
import { RestartWhenIdleCoordinator } from "./RestartWhenIdleCoordinator";

function setup() {
  mocks.setWorking(0);
  mocks.installLocalUpdate.mockClear();
  cancelRestartWhenIdle();
  const bridge = {} as DesktopBridge;
  const stub = stubGlobal("desktopBridge", bridge);
  return {
    bridge,
    [Symbol.dispose]: () => {
      stub[Symbol.dispose]();
      cancelRestartWhenIdle();
    },
  };
}

it("installs only after no agent has worked for the whole quiet period", async () => {
  using env = setup();
  mocks.setWorking(2);
  scheduleRestartWhenIdle(0);
  // The coordinator renders nothing and reads no route.
  await using _screen = await render(<RestartWhenIdleCoordinator />, { router: false });
  using _timers = fakeTimers();

  await act(() => mocks.setWorking(0));
  await act(() => vi.advanceTimersByTime(RESTART_WHEN_IDLE_QUIET_MS - 1));
  // A turn that starts inside the quiet period restarts the wait.
  await act(() => mocks.setWorking(1));
  await act(() => vi.advanceTimersByTime(RESTART_WHEN_IDLE_QUIET_MS));
  expect(mocks.installLocalUpdate).not.toHaveBeenCalled();

  await act(() => mocks.setWorking(0));
  await act(() => vi.advanceTimersByTime(RESTART_WHEN_IDLE_QUIET_MS - 1));
  expect(mocks.installLocalUpdate).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(1));

  expect(mocks.installLocalUpdate).toHaveBeenCalledExactlyOnceWith(env.bridge, undefined, "9.9.9");
  expect(isRestartWhenIdleScheduled()).toBe(false);
});

it("does nothing until a restart is scheduled", async () => {
  using _env = setup();
  // The coordinator renders nothing and reads no route.
  await using _screen = await render(<RestartWhenIdleCoordinator />, { router: false });
  using _timers = fakeTimers();

  await act(() => vi.advanceTimersByTime(RESTART_WHEN_IDLE_QUIET_MS * 2));
  expect(mocks.installLocalUpdate).not.toHaveBeenCalled();
});
