import type { ThreadSummary, ThreadSummaryResult } from "@t3tools/contracts";

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
}): ThreadSummaryPresentation {
  const { data } = input;
  const summary = data?.summary ?? null;
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
