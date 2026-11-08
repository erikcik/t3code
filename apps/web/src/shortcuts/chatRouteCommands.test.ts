import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import * as commandPalette from "../commandPaletteBus";
import * as pickerStore from "../draftProjectPickerStore";
import * as newThread from "../hooks/useHandleNewThread";
import * as settings from "../hooks/useSettings";
import * as threadActions from "../lib/chatThreadActions";
import * as entities from "../state/entities";
import type { Project } from "../types";
import { installChatRouteCommands } from "./chatRouteCommands";
import * as dispatcher from "./dispatcher";

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("new thread commands", () => {
  it.each([
    { mode: "normal", count: 2, command: "chat.new", picker: true },
    { mode: "boring", count: 2, command: "chat.new", picker: true },
    { mode: "boring", count: 1, command: "chat.new", picker: false },
    { mode: "legacy", count: 2, command: "chat.new", picker: false },
    { mode: "boring", count: 2, command: "chat.newLocal", picker: false },
  ] as const)("$mode sidebar, $count projects, $command: picker=$picker", (scenario) => {
    using _settings = vi.spyOn(settings, "getClientSettings").mockReturnValue({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
      legacySidebarEnabled: scenario.mode === "legacy",
    });
    using _projects = vi
      .spyOn(entities, "readProjects")
      .mockReturnValue([project("active"), project("idle")].slice(0, scenario.count));
    using openPicker = vi.spyOn(commandPalette, "openCommandPalette").mockImplementation(() => {});
    using startLocal = vi.spyOn(threadActions, "startNewThreadFromContext").mockResolvedValue(true);
    using register = vi.spyOn(dispatcher, "registerCommands").mockReturnValue(() => {});
    const router = { state: { matches: [] } } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    const commands = register.mock.calls[0]![0];
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    commands[scenario.command]!(event);

    if (scenario.picker) {
      expect(openPicker).toHaveBeenCalledWith({ open: "new-thread-in" });
      expect(startLocal).not.toHaveBeenCalled();
    } else {
      expect(openPicker).not.toHaveBeenCalled();
      expect(startLocal).toHaveBeenCalledOnce();
    }
  });
});

describe("chat.pickProject", () => {
  it.each([
    { route: "a showing draft", params: { draftId: "draft-1" }, showing: true },
    { route: "a hidden draft", params: { draftId: "draft-1" }, showing: false },
    { route: "a thread", params: { environmentId: "local", threadId: "thread-1" }, showing: false },
  ])("on $route", async (scenario) => {
    using _projects = vi.spyOn(entities, "readProjects").mockReturnValue([project("active")]);
    using _showing = vi
      .spyOn(pickerStore, "isDraftProjectPickerShowing")
      .mockReturnValue(scenario.showing);
    using toggle = vi.spyOn(pickerStore, "toggleDraftProjectPicker").mockImplementation(() => {});
    using request = vi.spyOn(pickerStore, "requestDraftProjectPicker").mockImplementation(() => {});
    const handleNewThread = vi.fn().mockResolvedValue({ draftId: "draft-2" });
    using _handler = vi.spyOn(newThread, "createNewThreadHandler").mockReturnValue(handleNewThread);
    using register = vi.spyOn(dispatcher, "registerCommands").mockReturnValue(() => {});
    const router = { state: { matches: [{ params: scenario.params }] } } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;

    register.mock.calls[0]![0]["chat.pickProject"]!(event);

    if (scenario.showing) {
      expect(toggle).toHaveBeenCalledWith("draft-1");
      expect(handleNewThread).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() => expect(request).toHaveBeenCalledWith("draft-2"));
      expect(toggle).not.toHaveBeenCalled();
    }
  });
});
