import * as Context from "effect/Context";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { ThreadId, ThreadSummary } from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  type ThreadSummaryRepositoryError,
} from "./Errors.ts";

const SummaryRow = Schema.Struct({
  summary: Schema.fromJsonString(ThreadSummary),
});

export class ThreadSummaryRepository extends Context.Service<
  ThreadSummaryRepository,
  {
    readonly get: (
      threadId: ThreadId,
    ) => Effect.Effect<Option.Option<ThreadSummary>, ThreadSummaryRepositoryError>;
    readonly put: (summary: ThreadSummary) => Effect.Effect<void, ThreadSummaryRepositoryError>;
  }
>()("t3/persistence/ThreadSummaries/ThreadSummaryRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Fork-only regenerable cache: created here rather than as a numbered migration so upstream's
  // next migration ids never collide with it.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_summaries (
      thread_id TEXT PRIMARY KEY,
      summary_json TEXT NOT NULL
    ) WITHOUT ROWID
  `.pipe(Effect.orDie);

  const findSummary = SqlSchema.findOneOption({
    Request: ThreadId,
    Result: SummaryRow,
    execute: (threadId) =>
      sql`SELECT summary_json AS "summary" FROM thread_summaries WHERE thread_id = ${threadId}`,
  });
  const encodeSummary = Schema.encodeEffect(Schema.fromJsonString(ThreadSummary));

  return ThreadSummaryRepository.of({
    get: Effect.fn("ThreadSummaryRepository.get")(function (threadId) {
      return findSummary(threadId).pipe(
        NodeSqliteClient.readOnly,
        Effect.map(Option.map((row) => row.summary)),
        Effect.mapError((cause) =>
          Schema.isSchemaError(cause)
            ? PersistenceDecodeError.fromSchemaError("ThreadSummary", cause)
            : new PersistenceSqlError({ operation: "getThreadSummary", cause }),
        ),
      );
    }),
    put: Effect.fn("ThreadSummaryRepository.put")(function (summary) {
      return encodeSummary(summary).pipe(
        Effect.mapError((cause) => PersistenceDecodeError.fromSchemaError("ThreadSummary", cause)),
        Effect.flatMap((summaryJson) =>
          sql`
            INSERT INTO thread_summaries (thread_id, summary_json)
            VALUES (${summary.threadId}, ${summaryJson})
            ON CONFLICT (thread_id) DO UPDATE SET summary_json = excluded.summary_json
          `.pipe(
            Effect.mapError(
              (cause) => new PersistenceSqlError({ operation: "putThreadSummary", cause }),
            ),
          ),
        ),
        Effect.asVoid,
      );
    }),
  });
});

export const layer = Layer.effect(ThreadSummaryRepository, make);
