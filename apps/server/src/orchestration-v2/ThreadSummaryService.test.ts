import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  TextGenerationError,
  ThreadId,
} from "@t3tools/contracts";
import { THREAD_SUMMARY_TRANSCRIPT_LIMIT } from "@t3tools/provider-core/server/textGenerationPrompts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ThreadSummaries from "../persistence/ThreadSummaries.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ThreadSummaryService from "./ThreadSummaryService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const projectId = ProjectId.make("project:thread-summary");
const textGenerationModel = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4-mini",
  options: [{ id: "reasoningEffort", value: "low" }],
};

const adapter = {
  instanceId: textGenerationModel.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in thread summary tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const readyProvider = (instanceId: ProviderInstanceId, driver: string): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-18T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
});

function makeHarness(options: {
  readonly generateSummary: TextGeneration.TextGeneration["Service"]["generateThreadSummary"];
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  readonly providers?: ReadonlyArray<ServerProvider>;
}) {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerOrchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "thread-summary" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  );
  const layerServerSettings = ServerSettings.layerTest({
    textGenerationModelSelection: textGenerationModel,
    ...options.settings,
  });
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerOrchestrator),
    Layer.provide(layerServerSettings),
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
  );
  const generateThreadSummary = vi.fn(options.generateSummary);
  const layerProjects = Layer.mock(ProjectStore.ProjectStoreV2)({
    get: (requested) =>
      Effect.succeed(
        requested === projectId
          ? Option.some({
              projectId,
              title: "Project",
              workspaceRoot: "/repo",
              defaultModelSelection: textGenerationModel,
              defaultThreadEnvMode: null,
              hasCustomTitle: false,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              pinnedAt: null,
              archivedAt: null,
              createdAt: "2026-11-18T00:00:00.000Z",
              updatedAt: "2026-11-18T00:00:00.000Z",
              deletedAt: null,
            })
          : Option.none(),
      ),
  });
  const layerSummaries = ThreadSummaryService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerThreadManagement,
        layerProjects,
        layerServerSettings,
        Layer.mock(TextGeneration.TextGeneration)({ generateThreadSummary }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed(options.providers ?? []),
        }),
        ThreadSummaries.layer.pipe(Layer.provide(layerDatabase)),
        NodeServices.layer,
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(layerOrchestrator, layerThreadManagement, layerSummaries, layerDatabase),
    generateThreadSummary,
  };
}

const createThread = Effect.fn(function* (name: string) {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const threadId = ThreadId.make(`thread:summary:${name}`);
  yield* threads.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`command:summary:${name}:create`),
    threadId,
    projectId,
    title: "Login flake",
    modelSelection: textGenerationModel,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  return threadId;
});

const recordMessages = Effect.fn(function* (
  threadId: ThreadId,
  messages: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>,
) {
  const eventSink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  yield* eventSink.write({
    events: messages.map((message, index) => ({
      id: EventId.make(`${threadId}:message:${index}`),
      type: "message.updated" as const,
      threadId,
      occurredAt: now,
      payload: {
        id: MessageId.make(`${threadId}:message:${index}`),
        threadId,
        runId: null,
        nodeId: null,
        role: message.role,
        text: message.text,
        attachments: [],
        streaming: false,
        createdBy: "user" as const,
        creationSource: "web" as const,
        createdAt: now,
        updatedAt: now,
      },
    })),
  });
});

const conversation = [
  { role: "user", text: "Why does the login test flake on CI?" },
  { role: "assistant", text: "The session cookie expires before the redirect." },
] as const;

describe("ThreadSummaryService", () => {
  it.effect("stores a summary with its model and replaces it when regenerated", () => {
    const outputs = ["- **Goal:** Fix the login flake", "- **Goal:** Stop the login test flaking"];
    const harness = makeHarness({
      generateSummary: () => Effect.sync(() => ({ summary: outputs.shift() ?? "unexpected" })),
    });
    return Effect.gen(function* () {
      const summaries = yield* ThreadSummaryService.ThreadSummaryService;
      const threadId = yield* createThread("stores");
      yield* recordMessages(threadId, conversation);

      assert.deepStrictEqual(yield* summaries.get(threadId), { summary: null, generating: false });

      const first = yield* summaries.generate(threadId);
      assert.equal(first.markdown, "- **Goal:** Fix the login flake");
      assert.deepStrictEqual(first.modelSelection, textGenerationModel);
      const call = harness.generateThreadSummary.mock.calls[0]?.[0];
      assert.equal(call?.cwd, "/repo");
      assert.equal(call?.threadTitle, "Login flake");
      assert.deepStrictEqual(call?.modelSelection, textGenerationModel);
      assert.include(call?.transcript, "USER:\nWhy does the login test flake on CI?");
      assert.include(call?.transcript, "ASSISTANT:\nThe session cookie expires");
      assert.deepStrictEqual(yield* summaries.get(threadId), { summary: first, generating: false });

      yield* summaries.generate(threadId);
      assert.equal(
        (yield* summaries.get(threadId)).summary?.markdown,
        "- **Goal:** Stop the login test flaking",
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("runs one generation for concurrent requests on the same thread", () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const harness = makeHarness({
      generateSummary: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({ summary: "- **Goal:** One run" }),
        ),
    });
    return Effect.gen(function* () {
      const summaries = yield* ThreadSummaryService.ThreadSummaryService;
      const threadId = yield* createThread("coalesce");
      yield* recordMessages(threadId, conversation);

      const first = yield* summaries.generate(threadId).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const second = yield* summaries
        .generate(threadId)
        .pipe(Effect.forkChild({ startImmediately: true }));
      assert.isTrue((yield* summaries.get(threadId)).generating);

      yield* Deferred.succeed(release, undefined);
      const [a, b] = [yield* Fiber.join(first), yield* Fiber.join(second)];
      assert.deepStrictEqual(a, b);
      assert.equal(harness.generateThreadSummary.mock.calls.length, 1);
      assert.isFalse((yield* summaries.get(threadId)).generating);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("uses the pinned summary model and its effort instead of the text model", () => {
    const pinned = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-haiku-4-5",
      options: [{ id: "effort", value: "low" }],
    };
    const harness = makeHarness({
      generateSummary: () => Effect.succeed({ summary: "- **Goal:** Pinned" }),
      settings: { threadSummaryModelSelection: pinned },
      providers: [readyProvider(pinned.instanceId, "claudeAgent")],
    });
    return Effect.gen(function* () {
      const summaries = yield* ThreadSummaryService.ThreadSummaryService;
      const threadId = yield* createThread("pinned");
      yield* recordMessages(threadId, conversation);

      const summary = yield* summaries.generate(threadId);
      assert.deepStrictEqual(
        harness.generateThreadSummary.mock.calls[0]?.[0].modelSelection,
        pinned,
      );
      assert.deepStrictEqual(summary.modelSelection, pinned);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("bounds a long transcript while keeping the opening request", () => {
    const harness = makeHarness({
      generateSummary: () => Effect.succeed({ summary: "- **Goal:** Long" }),
    });
    return Effect.gen(function* () {
      const summaries = yield* ThreadSummaryService.ThreadSummaryService;
      const threadId = yield* createThread("bounded");
      yield* recordMessages(threadId, [
        { role: "user", text: `Migrate sessions to Postgres ${"a".repeat(20_000)}` },
        ...Array.from({ length: 6 }, (_, index) => ({
          role: index % 2 === 0 ? ("assistant" as const) : ("user" as const),
          text: `${index} ${"b".repeat(20_000)}`,
        })),
      ]);

      yield* summaries.generate(threadId);
      const transcript = harness.generateThreadSummary.mock.calls[0]?.[0].transcript ?? "";
      assert.isAtMost(transcript.length, THREAD_SUMMARY_TRANSCRIPT_LIMIT);
      assert.include(transcript, "USER:\nMigrate sessions to Postgres");
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("reports why nothing was written and keeps no summary", () => {
    const harness = makeHarness({
      generateSummary: () =>
        Effect.fail(
          new TextGenerationError({
            operation: "generateThreadSummary",
            detail: "codex exited\nUsage limit reached.",
          }),
        ),
    });
    return Effect.gen(function* () {
      const summaries = yield* ThreadSummaryService.ThreadSummaryService;
      const missing = yield* summaries
        .generate(ThreadId.make("thread:summary:missing"))
        .pipe(Effect.flip);
      assert.equal(missing.reason, "not-found");

      const empty = yield* createThread("empty");
      assert.equal((yield* summaries.generate(empty).pipe(Effect.flip)).reason, "empty");

      const failing = yield* createThread("failing");
      yield* recordMessages(failing, conversation);
      const failure = yield* summaries.generate(failing).pipe(Effect.flip);
      assert.deepInclude(failure, { reason: "failed", detail: "Usage limit reached." });
      assert.deepStrictEqual(yield* summaries.get(failing), { summary: null, generating: false });
      yield* summaries.generate(failing).pipe(Effect.flip);
      assert.equal(harness.generateThreadSummary.mock.calls.length, 2);
    }).pipe(Effect.provide(harness.layer));
  });
});
