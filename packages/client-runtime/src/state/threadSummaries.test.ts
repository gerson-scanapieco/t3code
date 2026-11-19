import { ProviderInstanceId, ThreadId, type ThreadSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSummaryPresentation } from "./threadSummaries.ts";

const summary: ThreadSummary = {
  threadId: ThreadId.make("thread-1"),
  markdown: "Fixed the flaky test.",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  generatedAt: "2026-11-19T10:00:00.000Z",
};

const base = {
  data: { summary: null, generating: false },
  isPending: false,
  queryError: null,
  failure: null,
  generating: false,
  canGenerate: true,
};

describe("resolveThreadSummaryPresentation", () => {
  it("offers Generate before a summary exists and Regenerate after", () => {
    expect(resolveThreadSummaryPresentation(base)).toMatchObject({
      body: { kind: "empty" },
      action: { kind: "generate", disabled: false },
    });
    expect(
      resolveThreadSummaryPresentation({ ...base, data: { summary, generating: false } }),
    ).toMatchObject({
      body: { kind: "summary", summary },
      action: { kind: "regenerate", disabled: false },
    });
  });

  it("shows a just-generated summary until the read returns one at least as new", () => {
    const newer = {
      ...summary,
      markdown: "Rewrote the test.",
      generatedAt: "2026-11-19T11:00:00.000Z",
    };
    expect(resolveThreadSummaryPresentation({ ...base, generated: newer }).body).toEqual({
      kind: "summary",
      summary: newer,
    });
    expect(
      resolveThreadSummaryPresentation({
        ...base,
        data: { summary, generating: false },
        generated: newer,
      }).body,
    ).toEqual({ kind: "summary", summary: newer });
    expect(
      resolveThreadSummaryPresentation({
        ...base,
        data: { summary: newer, generating: false },
        generated: summary,
      }).body,
    ).toEqual({ kind: "summary", summary: newer });
  });

  it("disables the action without permission or while a run is in flight", () => {
    expect(resolveThreadSummaryPresentation({ ...base, canGenerate: false }).action).toEqual({
      kind: "generate",
      disabled: true,
    });
    expect(
      resolveThreadSummaryPresentation({
        ...base,
        data: { summary, generating: false },
        generating: true,
      }),
    ).toMatchObject({ body: { kind: "summary" }, action: { kind: "generating", disabled: true } });
  });

  it("shows another client's run only to a viewer who cannot join it", () => {
    const serverRun = { ...base, data: { summary: null, generating: true } };
    expect(resolveThreadSummaryPresentation({ ...serverRun, canGenerate: false })).toMatchObject({
      body: { kind: "writing" },
      action: { kind: "generating", disabled: true },
    });
    // A permitted viewer joins the run itself, and its own flag drives the progress.
    expect(resolveThreadSummaryPresentation(serverRun).action).toEqual({
      kind: "generate",
      disabled: false,
    });
  });

  it("hides the action until the first read and keeps read errors behind loaded data", () => {
    expect(
      resolveThreadSummaryPresentation({ ...base, data: null, isPending: true }),
    ).toMatchObject({ body: { kind: "loading" }, action: null });
    expect(
      resolveThreadSummaryPresentation({ ...base, data: null, queryError: "Offline" }),
    ).toMatchObject({ body: { kind: "none" }, action: null, error: "Offline" });
    expect(resolveThreadSummaryPresentation({ ...base, queryError: "Offline" }).error).toBeNull();
    expect(
      resolveThreadSummaryPresentation({ ...base, failure: "No model", queryError: "Offline" })
        .error,
    ).toBe("No model");
  });
});
