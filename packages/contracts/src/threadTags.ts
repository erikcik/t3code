import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Tags match by exact spelling and case after trimming. */
export const ThreadTag = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.makeFilter((value) =>
    /[\p{Cc}]/u.test(value) ? "A thread tag must be a single line of text." : true,
  ),
);
export type ThreadTag = typeof ThreadTag.Type;

/** Tags read back from storage or a peer. Lenient so a later tag rule never fails a whole thread. */
export const StoredThreadTags = Schema.Array(Schema.String).pipe(
  Schema.catchDecoding(() => Effect.succeedSome([])),
);

/** Threads with this tag get a CEO side chat after each finished turn. */
export const CEO_THREAD_TAG = "ceo";

export const isCeoThreadTag = (tag: string): boolean => tag.trim().toLowerCase() === CEO_THREAD_TAG;

export const hasCeoThreadTag = (tags: ReadonlyArray<string> | undefined): boolean =>
  tags?.some(isCeoThreadTag) === true;

/**
 * Threads with this tag show a yellow Autopilot status in the sidebar. Agents set it only when the
 * user explicitly asks for autopilot, e.g. for a recurring loop they run on their own.
 */
export const AUTOPILOT_THREAD_TAG = "autopilot";

export const isAutopilotThreadTag = (tag: string): boolean =>
  tag.trim().toLowerCase() === AUTOPILOT_THREAD_TAG;

export const hasAutopilotThreadTag = (tags: ReadonlyArray<string> | undefined): boolean =>
  tags?.some(isAutopilotThreadTag) === true;
