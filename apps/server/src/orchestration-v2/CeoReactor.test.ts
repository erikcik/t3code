import { describe, expect, it } from "@effect/vitest";
import {
  ContextTransferId,
  EventId,
  MessageId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ContextTransfer,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";

import * as ServerConfig from "../config.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CeoReactor from "./CeoReactor.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

const at = DateTime.makeUnsafe("2026-11-09T12:00:00.000Z");
const threadId = ThreadId.make("ceo-parent");
const instanceId = ProviderInstanceId.make("claudeAgent");
const modelSelection = { instanceId, model: "claude-opus-5-5" };
const providerThreadId = ProviderThreadId.make("ceo-provider-thread");

type Records = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "messages" | "providerThreads" | "contextTransfers"
>;

function run(ordinal: number, status: OrchestrationV2ThreadProjection["runs"][number]["status"]) {
  return {
    id: RunId.make(`ceo-run-${ordinal}`),
    threadId,
    ordinal,
    providerInstanceId: instanceId,
    modelSelection,
    providerThreadId,
    userMessageId: MessageId.make(`ceo-user-${ordinal}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at,
    startedAt: at,
    completedAt: status === "completed" ? at : null,
    checkpointId: null,
    contextHandoffId: null,
  };
}

function message(ordinal: number, role: "user" | "assistant", text: string) {
  return {
    id: MessageId.make(`ceo-${role}-${ordinal}`),
    threadId,
    runId: RunId.make(`ceo-run-${ordinal}`),
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: false,
    createdBy: role === "user" ? ("user" as const) : ("agent" as const),
    creationSource: "web" as const,
    createdAt: at,
    updatedAt: at,
  };
}

function records(): Records {
  return {
    thread: {
      id: threadId,
      projectId: ProjectId.make("ceo-project"),
      title: "Launch the store",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      tags: ["ceo"],
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: at,
      deletedAt: null,
    },
    runs: [run(1, "completed")],
    messages: [
      message(1, "user", "Build the checkout page"),
      message(1, "assistant", "Done. Next we could add coupons."),
    ],
    providerThreads: [
      {
        id: providerThreadId,
        driver: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: instanceId,
        providerSessionId: null,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: {
          driver: ProviderDriverKind.make("claudeAgent"),
          nativeId: "native-session",
          strength: "strong",
        },
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        createdAt: at,
        updatedAt: at,
      },
    ],
    contextTransfers: [],
  };
}

function forkTransfer(targetThreadId: ThreadId): OrchestrationV2ContextTransfer {
  return {
    id: ContextTransferId.make(`transfer-${targetThreadId}`),
    type: "fork",
    sourceThreadId: threadId,
    targetThreadId,
    sourcePoint: { threadId },
    basePoint: null,
    sourceProviderInstanceId: instanceId,
    targetProviderInstanceId: null,
    targetRunId: null,
    status: "resolved_portable",
    resolution: null,
    createdBy: "agent",
    error: null,
    createdAt: at,
    updatedAt: at,
    consumedAt: null,
  };
}

function runReactor(input: {
  readonly parent: Records;
  readonly children?: ReadonlyArray<Records>;
}) {
  return Effect.gen(function* () {
    const done = yield* Deferred.make<void>();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const cleaned: Array<string> = [];
    const written = new Map<string, string>();
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (...args) => {
          end(...args);
          if (span.name === "CeoReactor.review") Deferred.doneUnsafe(done, Effect.void);
        };
        return span;
      },
    });
    const byId = new Map(
      [input.parent, ...(input.children ?? [])].map((entry) => [entry.thread.id, entry]),
    );
    const dependencies = Layer.mergeAll(
      Layer.mock(Orchestrator.OrchestratorV2)({
        streamDomainEvents: Stream.make({
          id: EventId.make("ceo-run-completed"),
          type: "run.updated",
          threadId,
          runId: input.parent.runs.at(-1)!.id,
          occurredAt: at,
          payload: input.parent.runs.find((candidate) => candidate.status === "completed")!,
        }),
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length, storedEvents: [] };
          }),
      }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadRecords: (id) => Effect.succeed(byId.get(id) as never),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () =>
          Effect.succeedSome({
            title: "Store",
            workspaceRoot: "/work/store",
          } as ProjectStore.ProjectRow),
      }),
      Layer.mock(TextGeneration.TextGeneration)({
        generateCeoContext: (request) =>
          Effect.sync(() => {
            cleaned.push(request.transcript);
            return { context: "CLEANED_CONTEXT" };
          }),
      }),
      FileSystem.layerNoop({
        readFileString: () => Effect.fail(new Error("no instructions file") as never),
        exists: () => Effect.succeed(false),
        makeDirectory: () => Effect.void,
        writeFileString: (path, data) => Effect.sync(() => void written.set(path, data)),
      }),
      Layer.succeed(ServerConfig.ServerConfig, {
        stateDir: "/state",
      } as ServerConfig.ServerConfig["Service"]),
      Path.layer,
    );
    yield* Effect.gen(function* () {
      const reactor = yield* CeoReactor.make;
      yield* reactor.start();
      yield* Deferred.await(done);
    }).pipe(Effect.provide(dependencies), Effect.withTracer(tracer));
    return { dispatched, cleaned, written };
  });
}

describe("CeoReactor", () => {
  it.effect.each([
    { name: "tagged and idle", change: (data: Records) => data, reviews: true },
    {
      name: "untagged",
      change: (data: Records) => ({ ...data, thread: { ...data.thread, tags: [] } }),
      reviews: false,
    },
    {
      name: "queued work",
      change: (data: Records) => ({ ...data, runs: [...data.runs, run(2, "queued")] }),
      reviews: false,
    },
    {
      name: "a side chat",
      change: (data: Records) => ({
        ...data,
        thread: { ...data.thread, lineage: { ...data.thread.lineage, sideChat: true } },
      }),
      reviews: false,
    },
    {
      name: "an idle compaction turn",
      change: (data: Records) => ({
        ...data,
        messages: [{ ...data.messages[0]!, idleCompaction: "beforeCacheExpires" as const }],
      }),
      reviews: false,
    },
  ])("reviews only a finished, idle, CEO-tagged thread: $name", ({ change, reviews }) =>
    Effect.gen(function* () {
      const { dispatched, cleaned } = yield* runReactor({ parent: change(records()) });
      expect(cleaned.length > 0).toBe(reviews);
      expect(dispatched.length > 0).toBe(reviews);
    }),
  );

  it.effect("hands the CEO only the cleaned context and replaces unanswered proposals", () =>
    Effect.gen(function* () {
      const unanswered = ThreadId.make("ceo:ceo-parent:0");
      const answered = ThreadId.make("ceo:ceo-parent:-1");
      const child = (id: ThreadId, runs: number): Records => {
        const base = records();
        return {
          ...base,
          thread: {
            ...base.thread,
            id,
            tags: [],
            lineage: {
              ...base.thread.lineage,
              parentThreadId: threadId,
              sideChat: true,
              ceo: true,
            },
          },
          runs: Array.from({ length: runs }, (_, index) => run(index + 1, "completed")),
        };
      };
      const parent = {
        ...records(),
        contextTransfers: [forkTransfer(unanswered), forkTransfer(answered)],
      };
      const { dispatched, cleaned, written } = yield* runReactor({
        parent,
        children: [child(unanswered, 1), child(answered, 2)],
      });

      expect(cleaned[0]).toContain("User: Build the checkout page");
      const contextPath = "/state/ceo/ceo-parent/turn-1.md";
      expect(written.get(contextPath)).toContain("CLEANED_CONTEXT");
      const [fork, brief, ...rest] = dispatched;
      expect(fork).toMatchObject({
        type: "thread.fork",
        sourceThreadId: threadId,
        targetThreadId: "ceo:ceo-parent:1",
        sideChat: true,
        ceo: true,
      });
      expect(brief).toMatchObject({
        type: "message.dispatch",
        threadId: "ceo:ceo-parent:1",
        modelSelection: { model: "claude-opus-5-5" },
      });
      const text = brief?.type === "message.dispatch" ? brief.text : "";
      expect(text).toContain(contextPath);
      expect(text).toContain("native-session");
      expect(text).not.toContain("coupons");
      expect(rest).toMatchObject([{ type: "thread.delete", threadId: unanswered }]);
    }),
  );
});
