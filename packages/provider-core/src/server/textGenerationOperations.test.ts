import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decodeJsonReply, fromRunner } from "./textGenerationOperations.ts";

// regression: #23726 a reply that echoes the schema key replaced the seed title with "title"
it.effect("fails a thread title reply that is only the schema key", () =>
  Effect.gen(function* () {
    const textGeneration = fromRunner("Stub", (request) =>
      decodeJsonReply(request, "Stub", '{"title":"title","needsRefinement":false}'),
    );

    const outcome = yield* textGeneration
      .generateThreadTitle({
        cwd: process.cwd(),
        message: "$implement Issue #140",
        modelSelection: {
          instanceId: ProviderInstanceId.make("pi"),
          model: "anthropic/claude-haiku-4-5",
        },
      })
      .pipe(Effect.match({ onFailure: (error) => error, onSuccess: (result) => result }));

    assert.instanceOf(outcome, TextGenerationError);
    assert.strictEqual(outcome.operation, "generateThreadTitle");
  }),
);

it.effect.each([
  {
    name: "unwraps a summary nested in its own schema",
    reply: { summary: '{"summary": "- **Goal:** Ship"}' },
    expected: "- **Goal:** Ship",
  },
  {
    name: "keeps a plain summary",
    reply: { summary: "- **Goal:** Ship" },
    expected: "- **Goal:** Ship",
  },
  { name: "fails an empty summary", reply: { summary: "  " }, expected: null },
])("$name", ({ reply, expected }) =>
  Effect.gen(function* () {
    const textGeneration = fromRunner("Stub", (request) =>
      decodeJsonReply(request, "Stub", JSON.stringify(reply)),
    );

    const outcome = yield* textGeneration
      .generateThreadSummary({
        cwd: process.cwd(),
        threadTitle: "Ship it",
        transcript: "USER:\nShip it",
        modelSelection: {
          instanceId: ProviderInstanceId.make("pi"),
          model: "anthropic/claude-haiku-4-5",
        },
      })
      .pipe(Effect.match({ onFailure: (error) => error, onSuccess: (result) => result.summary }));

    if (expected === null) assert.instanceOf(outcome, TextGenerationError);
    else assert.strictEqual(outcome, expected);
  }),
);
