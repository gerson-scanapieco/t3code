import { WS_METHODS } from "@t3tools/contracts";
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
