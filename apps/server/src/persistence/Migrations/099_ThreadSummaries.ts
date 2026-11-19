import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A regenerable cache beside the event log: summaries never feed orchestration or projections.
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_summaries (
      thread_id TEXT PRIMARY KEY,
      summary_json TEXT NOT NULL
    ) WITHOUT ROWID
  `;
});
