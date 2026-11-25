import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type { PiSettings } from "../settings.ts";
import {
  parsePiGoalVerdict,
  piGoalEvaluatorPrompt,
  PI_GOAL_EVALUATOR_SYSTEM_PROMPT,
  type PiGoalVerdict,
} from "./goals.ts";
import { buildPiRpcLaunch, resolvePiLaunchArgs } from "./mcpInjection.ts";
import { makePiRpcConnection, parsePiModelSlug, piRecordString } from "./rpc.ts";

export class PiGoalCheckError extends Schema.TaggedError<PiGoalCheckError>()("PiGoalCheckError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export interface PiGoalEvaluation {
  /** Pi `provider/model` slug, or null for the Pi default model. */
  readonly model: string | null;
  readonly transcript: string;
  readonly condition: string;
}

export type PiGoalEvaluator = (
  evaluation: PiGoalEvaluation,
) => Effect.Effect<PiGoalVerdict, PiGoalCheckError>;

// Pi's errorMessage can echo provider response text, so only a leading HTTP status is kept.
const providerErrorDetail = (errorMessage: string | undefined) => {
  const status = errorMessage?.match(/^([45]\d\d)\b/)?.[1];
  return status === undefined
    ? "the evaluator model reported an error"
    : `the evaluator model returned HTTP ${status}`;
};

/**
 * Runs the goal evaluator in a separate, ephemeral Pi with no tools. Extensions stay on because
 * gateway providers such as NanoGPT register their models through one.
 */
export const makePiGoalEvaluator = (input: {
  readonly settings: PiSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}): PiGoalEvaluator =>
  Effect.fn("PiGoalEvaluator.evaluate")(
    function* (evaluation) {
      const launchArgs = resolvePiLaunchArgs(input.settings.launchArgs);
      if (!launchArgs.ok) return yield* new PiGoalCheckError({ detail: launchArgs.message });
      const launch = buildPiRpcLaunch({
        launchArgs: [
          ...launchArgs.args,
          "--system-prompt",
          PI_GOAL_EVALUATOR_SYSTEM_PROMPT,
          "--thinking",
          "off",
        ],
        environment: input.environment,
        mcpSession: undefined,
        extensionPath: undefined,
        ephemeral: true,
        disableTools: true,
      });
      const connection = yield* makePiRpcConnection({
        command: input.settings.binaryPath || "pi",
        args: launch.args,
        cwd: input.cwd,
        env: launch.env,
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner));
      if (evaluation.model !== null) {
        const parsed = parsePiModelSlug(evaluation.model);
        if (parsed === null) {
          return yield* new PiGoalCheckError({
            detail: `evaluator model '${evaluation.model}' must use provider/model format`,
          });
        }
        yield* connection.request({
          type: "set_model",
          provider: parsed.provider,
          modelId: parsed.modelId,
        });
      }
      yield* connection.request({
        type: "prompt",
        message: piGoalEvaluatorPrompt(evaluation.transcript, evaluation.condition),
      });
      let turnError: string | undefined;
      while (true) {
        const event = yield* Queue.take(connection.events);
        if (event["type"] === "agent_settled") break;
        const message = event["message"];
        if (event["type"] === "message_end" && piRecordString(message, "role") === "assistant") {
          turnError =
            piRecordString(message, "stopReason") === "error"
              ? providerErrorDetail(piRecordString(message, "errorMessage"))
              : undefined;
        }
      }
      const data = yield* connection.request({ type: "get_last_assistant_text" });
      const text =
        typeof data === "object" && data !== null && typeof Reflect.get(data, "text") === "string"
          ? String(Reflect.get(data, "text"))
          : "";
      const verdict = parsePiGoalVerdict(text);
      if (verdict === null) {
        return yield* new PiGoalCheckError({
          detail: turnError ?? "the evaluator did not return a valid verdict",
        });
      }
      return verdict;
    },
    Effect.scoped,
    Effect.mapError((cause) =>
      cause._tag === "PiGoalCheckError"
        ? cause
        : new PiGoalCheckError({ detail: "the evaluator could not run" }),
    ),
  );
