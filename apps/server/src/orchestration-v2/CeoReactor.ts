import {
  CommandId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  hasCeoThreadTag,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  type RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { forkParked } from "../serverActivation.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { buildCeoBrief, buildCeoTranscript } from "./CeoBrief.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

const CLAUDE_INSTANCE_ID = ProviderInstanceId.make("claudeAgent");

const CEO_MODEL: ModelSelection = {
  instanceId: CLAUDE_INSTANCE_ID,
  model: "claude-opus-5-5",
  options: [{ id: "effort", value: "xhigh" }],
};

const CONTEXT_MODEL: ModelSelection = {
  instanceId: CLAUDE_INSTANCE_ID,
  model: "claude-sonnet-5-5",
  options: [{ id: "effort", value: "medium" }],
};

// Rewrites the playbook every later CEO follows, so it gets the stronger model.
const FEEDBACK_MODEL: ModelSelection = {
  instanceId: CLAUDE_INSTANCE_ID,
  model: "claude-opus-5-5",
  options: [{ id: "effort", value: "high" }],
};

/** CEO side chats are created as `ceo:<parent>:<turn>`, so their events route without a read. */
const CEO_THREAD_PREFIX = "ceo:";

const FEEDBACK_LOG_HEADER =
  "# CEO feedback log\n\nEvery reply that judged a CEO proposal, oldest first. playbook.md is distilled from these.\n";

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

const BUSY_RUN_STATUSES: ReadonlyArray<OrchestrationV2Run["status"]> = [
  "queued",
  "preparing",
  "starting",
  "running",
  "waiting",
];

const isBusy = (run: Pick<OrchestrationV2Run, "status">) => BUSY_RUN_STATUSES.includes(run.status);

const isCeoReviewedThread = (
  thread: Pick<
    OrchestrationV2AppThread,
    "tags" | "lineage" | "delegatedFrom" | "archivedAt" | "deletedAt"
  >,
): boolean =>
  hasCeoThreadTag(thread.tags) &&
  thread.lineage.sideChat !== true &&
  thread.lineage.relationshipToParent !== "subagent" &&
  thread.delegatedFrom === undefined &&
  thread.archivedAt === null &&
  thread.deletedAt === null;

/**
 * Experimental CEO review: a finished turn of a `ceo` thread gets an Opus side chat that sees only
 * a transcript cleaned of next-step ideas. Replies judging a proposal go to `ceo/feedback.md` and
 * rewrite `ceo/playbook.md`, which every later brief carries.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;

  const userInstructions = fileSystem
    .readFileString(path.join(stateDir, "ceo-instructions.md"))
    .pipe(
      Effect.map((text) => (text.trim().length === 0 ? null : text.trim())),
      Effect.orElseSucceed(() => null),
    );

  const ceoDir = path.join(stateDir, "ceo");
  const playbookPath = path.join(ceoDir, "playbook.md");
  const feedbackPath = path.join(ceoDir, "feedback.md");
  const readText = (file: string) =>
    fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
  // Playbook rewrites read and write one file; two replies at once must not drop a lesson.
  const learning = yield* Semaphore.make(1);

  // Proposals the user never answered are replaced by the newer one.
  const supersede = Effect.fn("CeoReactor.supersede")(function* (
    parentThreadId: ThreadId,
    keepThreadId: ThreadId,
  ) {
    const { contextTransfers } = yield* projections.getThreadRecords(parentThreadId, [
      "contextTransfers",
    ]);
    for (const transfer of contextTransfers) {
      if (
        transfer.type !== "fork" ||
        transfer.sourceThreadId !== parentThreadId ||
        transfer.targetThreadId === keepThreadId
      ) {
        continue;
      }
      const child = yield* projections
        .getThreadRecords(transfer.targetThreadId, ["runs"])
        .pipe(Effect.orElseSucceed(() => null));
      if (
        child === null ||
        child.thread.lineage.ceo !== true ||
        child.thread.deletedAt !== null ||
        child.runs.length > 1 ||
        child.runs.some(isBusy)
      ) {
        continue;
      }
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make(`server:ceo-supersede:${child.thread.id}`),
        threadId: child.thread.id,
      });
    }
  });

  const review = Effect.fn("CeoReactor.review")(
    function* (threadId: ThreadId, runId: RunId) {
      const records = yield* projections.getThreadRecords(
        threadId,
        ["runs", "messages", "providerThreads"],
        { messageRoles: ["user", "assistant"] },
      );
      const { thread } = records;
      if (!isCeoReviewedThread(thread) || records.runs.some(isBusy)) return;
      const run = records.runs.find((candidate) => candidate.id === runId);
      if (run?.status !== "completed") return;
      const latest = records.runs.reduce((a, b) => (b.ordinal > a.ordinal ? b : a), run);
      if (latest.id !== run.id) return;
      // Idle compaction is housekeeping, not work worth reviewing.
      const trigger = records.messages.find((message) => message.id === run.userMessageId);
      if (trigger?.idleCompaction !== undefined) return;

      const project = yield* projects.get(thread.projectId);
      if (Option.isNone(project)) return;
      const transcript = buildCeoTranscript({ runs: records.runs, messages: records.messages });
      if (transcript.length === 0) return;
      // Storage cleanup removes worktrees but keeps the path; CLIs cannot spawn in a missing cwd.
      const worktreeExists =
        thread.worktreePath !== null &&
        (yield* fileSystem.exists(thread.worktreePath).pipe(Effect.orElseSucceed(() => false)));
      const cwd =
        worktreeExists && thread.worktreePath !== null
          ? thread.worktreePath
          : project.value.workspaceRoot;

      const { context } = yield* textGeneration.generateCeoContext({
        cwd,
        threadTitle: thread.title,
        transcript,
        modelSelection: CONTEXT_MODEL,
      });
      const contextDir = path.join(stateDir, "ceo", threadId);
      const contextPath = path.join(contextDir, `turn-${run.ordinal}.md`);
      yield* fileSystem.makeDirectory(contextDir, { recursive: true });
      yield* fileSystem.writeFileString(
        contextPath,
        `# Cleaned context of "${thread.title}"\n\n${context}\n`,
      );

      // Stable per finished turn, so a repeated event dispatches the same commands.
      const ceoThreadId = ThreadId.make(`ceo:${threadId}:${run.ordinal}`);
      const brief = buildCeoBrief({
        contextPath,
        projectTitle: project.value.title,
        projectRoot: project.value.workspaceRoot,
        worktreePath: worktreeExists ? thread.worktreePath : null,
        branch: thread.branch,
        threadTitle: thread.title,
        parentThreadId: threadId,
        excludedSessionIds: records.providerThreads.flatMap((providerThread) =>
          providerThread.nativeThreadRef?.nativeId == null
            ? []
            : [providerThread.nativeThreadRef.nativeId],
        ),
        userInstructions: yield* userInstructions,
        playbook: (yield* readText(playbookPath)).trim() || null,
      });
      // A newer turn must not cut in between the fork and its first message.
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* orchestrator.dispatch({
            type: "thread.fork",
            commandId: CommandId.make(`server:ceo-fork:${threadId}:${runId}`),
            createdBy: "agent",
            creationSource: "server",
            sourceThreadId: threadId,
            targetThreadId: ceoThreadId,
            sourcePoint: { type: "latest_stable" },
            title: "CEO · next move",
            sideChat: true,
            ceo: true,
          });
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(`server:ceo-brief:${threadId}:${runId}`),
            threadId: ceoThreadId,
            messageId: MessageId.make(`ceo-brief:${threadId}:${runId}`),
            text: brief,
            attachments: [],
            modelSelection: CEO_MODEL,
            createdBy: "agent",
            creationSource: "server",
            dispatchMode: { type: "start_immediately" },
          });
          yield* supersede(threadId, ceoThreadId);
        }),
      );
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("CEO review skipped", { threadId, cause })),
      ),
  );

  /** Saves the user's judgment of a CEO proposal and folds its lesson into the playbook. */
  const learn = Effect.fn("CeoReactor.learn")(
    function* (ceoThreadId: ThreadId, runId: RunId) {
      const records = yield* projections.getThreadRecords(ceoThreadId, ["runs", "messages"], {
        messageRoles: ["user", "assistant"],
      });
      const { thread } = records;
      const parentThreadId = thread.lineage.parentThreadId;
      if (thread.lineage.ceo !== true || parentThreadId === null) return;
      const run = records.runs.find((candidate) => candidate.id === runId);
      if (run === undefined) return;
      const reply = records.messages.find((message) => message.id === run.userMessageId);
      // The brief is the server's own message; only the user's replies carry a judgment.
      if (reply === undefined || reply.createdBy !== "user" || reply.text.trim() === "") return;
      const earlierRunIds = new Set(
        records.runs.filter((other) => other.ordinal < run.ordinal).map((other) => other.id),
      );
      const proposal = records.messages.findLast(
        (message) =>
          message.role === "assistant" &&
          !message.streaming &&
          message.runId !== null &&
          earlierRunIds.has(message.runId) &&
          message.text.trim() !== "",
      );
      if (proposal === undefined) return;
      const parent = yield* projections.getThread(parentThreadId);
      const project = yield* projects.get(parent.projectId);
      const projectTitle = Option.isSome(project) ? project.value.title : parent.title;
      const today = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
      const marker = `<!-- run:${runId} -->`;
      yield* learning.withPermits(1)(
        Effect.gen(function* () {
          const log = yield* readText(feedbackPath);
          if (log.includes(marker)) return;
          const judged = yield* textGeneration.generateCeoFeedback({
            cwd: stateDir,
            today,
            projectTitle,
            threadTitle: parent.title,
            proposal: proposal.text,
            reply: reply.text,
            playbook: yield* readText(playbookPath),
            modelSelection: FEEDBACK_MODEL,
          });
          if (judged.verdict === "none") return;
          const entry = [
            `## ${today} · ${judged.verdict} · ${projectTitle} · ${parent.title}`,
            marker,
            "",
            "**Your reply:**",
            quote(reply.text),
            "",
            `**Lesson:** ${judged.lesson}`,
            "",
            `**Proposal judged** (${ceoThreadId}):`,
            quote(proposal.text.slice(0, 600) + (proposal.text.length > 600 ? " [...]" : "")),
            "",
          ].join("\n");
          yield* fileSystem.makeDirectory(ceoDir, { recursive: true });
          yield* fileSystem.writeFileString(
            feedbackPath,
            `${log.trim() === "" ? FEEDBACK_LOG_HEADER : log.trimEnd() + "\n"}\n${entry}`,
          );
          if (judged.playbook !== "") {
            yield* fileSystem.writeFileString(playbookPath, `${judged.playbook}\n`);
          }
        }),
      );
    },
    (effect, ceoThreadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("CEO feedback not recorded", { ceoThreadId, cause }),
        ),
      ),
  );

  const start = Effect.fn("CeoReactor.start")(function* () {
    // Keyed by thread: a newer finished turn interrupts a review still cleaning the older one.
    const reviews = yield* FiberMap.make<ThreadId>();
    // Keyed by run, and never replaced: every reply the user sends is learned from.
    const lessons = yield* FiberMap.make<RunId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        if (event.type !== "run.updated") return Effect.void;
        const { id, status } = event.payload;
        if (event.threadId.startsWith(CEO_THREAD_PREFIX)) {
          return status === "completed" || status === "interrupted" || status === "failed"
            ? FiberMap.run(lessons, id, learn(event.threadId, id), { onlyIfMissing: true })
            : Effect.void;
        }
        return status === "completed"
          ? FiberMap.run(reviews, event.threadId, review(event.threadId, id))
          : Effect.void;
      }),
    );
  });
  return { start };
});
