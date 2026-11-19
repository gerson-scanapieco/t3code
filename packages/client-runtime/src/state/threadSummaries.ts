import { type ThreadSummary, type ThreadSummaryResult, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/** Thread summaries are read only when asked for, never pushed with the thread shell. */
export function createThreadSummaryEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const summary = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:threads:summary",
    tag: WS_METHODS.threadsSummary,
  });
  return {
    summary,
    /** Joins a summary already being written for the thread instead of starting another. */
    generate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:threads:generate-summary",
      tag: WS_METHODS.threadsGenerateSummary,
      onSettled: (target, registry) => Effect.sync(() => registry.refresh(summary(target))),
    }),
  };
}

export type ThreadSummaryBody =
  | { readonly kind: "loading" }
  | { readonly kind: "summary"; readonly summary: ThreadSummary }
  | { readonly kind: "writing" }
  | { readonly kind: "empty" }
  | { readonly kind: "none" };

export interface ThreadSummaryPresentation {
  readonly body: ThreadSummaryBody;
  readonly action: {
    readonly kind: "generate" | "regenerate" | "generating";
    readonly disabled: boolean;
  } | null;
  readonly error: string | null;
}

export function resolveThreadSummaryPresentation(input: {
  readonly data: ThreadSummaryResult | null;
  readonly isPending: boolean;
  readonly queryError: string | null;
  readonly failure: string | null;
  readonly generating: boolean;
  readonly canGenerate: boolean;
  /** The summary this client's last generate returned, shown until the read catches up. */
  readonly generated?: ThreadSummary | null;
}): ThreadSummaryPresentation {
  const { data } = input;
  const stored = data?.summary ?? null;
  const generated = input.generated ?? null;
  const summary =
    generated !== null && (stored === null || generated.generatedAt > stored.generatedAt)
      ? generated
      : stored;
  // Without permission to join another client's run, the server's flag is the only progress signal.
  const busy = input.generating || (data?.generating === true && !input.canGenerate);
  const body: ThreadSummaryBody =
    data === null
      ? { kind: input.isPending ? "loading" : "none" }
      : summary !== null
        ? { kind: "summary", summary }
        : busy
          ? { kind: "writing" }
          : { kind: "empty" };
  return {
    body,
    action:
      data === null
        ? null
        : {
            kind: busy ? "generating" : summary !== null ? "regenerate" : "generate",
            disabled: !input.canGenerate || busy,
          },
    error: input.failure ?? (data === null ? input.queryError : null),
  };
}
