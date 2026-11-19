import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/** Markdown the configured model wrote about a thread, kept until it is regenerated. */
export const ThreadSummary = Schema.Struct({
  threadId: ThreadId,
  markdown: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  generatedAt: IsoDateTime,
});
export type ThreadSummary = typeof ThreadSummary.Type;

export const ThreadSummaryInput = Schema.Struct({ threadId: ThreadId });
export type ThreadSummaryInput = typeof ThreadSummaryInput.Type;

export const ThreadSummaryResult = Schema.Struct({
  summary: Schema.NullOr(ThreadSummary),
  generating: Schema.Boolean,
});
export type ThreadSummaryResult = typeof ThreadSummaryResult.Type;

export class ThreadSummaryError extends Schema.TaggedError<ThreadSummaryError>()(
  "ThreadSummaryError",
  {
    reason: Schema.Literals(["not-found", "empty", "failed"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
