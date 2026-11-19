import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type RunId,
  TextGenerationError,
  type ThreadId,
  type ThreadSummary,
  ThreadSummaryError,
  type ThreadSummaryResult,
} from "@t3tools/contracts";
import { formatThreadTitleContext } from "@t3tools/provider-core/server/threadTitleContext";
import { THREAD_SUMMARY_TRANSCRIPT_LIMIT } from "@t3tools/provider-core/server/textGenerationPrompts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ThreadSummaries from "../persistence/ThreadSummaries.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectStore from "./ProjectStore.ts";
import { forkInheritedRunOrdinals, ProjectionStoreThreadNotFoundError } from "./ProjectionStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export class ThreadSummaryService extends Context.Service<
  ThreadSummaryService,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<ThreadSummaryResult, ThreadSummaryError>;
    /** Writes and stores a new summary; a request while one is being written joins it. */
    readonly generate: (threadId: ThreadId) => Effect.Effect<ThreadSummary, ThreadSummaryError>;
  }
>()("t3/orchestration-v2/ThreadSummaryService") {}

const MESSAGE_LIMIT = 4_000;
const MAX_FAILURE_DETAIL_LENGTH = 300;
const isThreadSummaryError = Schema.is(ThreadSummaryError);
const isTextGenerationError = Schema.is(TextGenerationError);
const isProjectionStoreThreadNotFoundError = Schema.is(ProjectionStoreThreadNotFoundError);

function failureDetail(error: unknown): string {
  const detail = isTextGenerationError(error)
    ? error.detail
        .split("\n")
        .map((line) => line.trim())
        .findLast((line) => line.length > 0)
    : undefined;
  if (detail === undefined) return "The summary could not be written.";
  return detail.length > MAX_FAILURE_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_FAILURE_DETAIL_LENGTH - 1)}…`
    : detail;
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const summaries = yield* ThreadSummaries.ThreadSummaryRepository;
  const serviceScope = yield* Effect.scope;
  const inFlight = new Map<ThreadId, Deferred.Deferred<ThreadSummary, ThreadSummaryError>>();

  const notFound = new ThreadSummaryError({
    reason: "not-found",
    detail: "This thread no longer exists.",
  });

  const messagesThroughRun = Effect.fn("ThreadSummaryService.messagesThroughRun")(function* (
    threadId: ThreadId,
    runId: RunId,
    forkCreatedAt: DateTime.Utc,
  ) {
    const source = yield* threads.getThreadRecords(threadId, ["messages", "runs"], {
      messageRoles: ["user", "assistant"],
    });
    const ordinals = forkInheritedRunOrdinals(source.runs, forkCreatedAt);
    const forkOrdinal = ordinals.get(runId);
    if (forkOrdinal === undefined) return undefined;
    const messages = source.messages.filter((message) => {
      if (message.runId === null) return source.thread.historyOrigin === "v1_import";
      return (ordinals.get(message.runId) ?? Infinity) <= forkOrdinal;
    });
    return { thread: source.thread, messages };
  });

  // A fork's own messages start after the history it inherited, which lives on its source threads.
  const inheritedMessages = Effect.fn("ThreadSummaryService.inheritedMessages")(function* (
    thread: OrchestrationV2AppThread,
  ) {
    const history: Array<ReadonlyArray<OrchestrationV2ConversationMessage>> = [];
    const seen = new Set([thread.id]);
    let current = thread;
    while (
      current.forkedFrom?.type === "run" &&
      current.lineage.sideChat !== true &&
      !seen.has(current.forkedFrom.threadId)
    ) {
      const { threadId, runId } = current.forkedFrom;
      seen.add(threadId);
      const source = yield* messagesThroughRun(threadId, runId, current.createdAt);
      if (source === undefined) break;
      history.push(source.messages);
      current = source.thread;
    }
    return history.reverse().flat();
  });

  const write = Effect.fn("ThreadSummaryService.write")(
    function* (threadId: ThreadId) {
      const projection = yield* threads
        .getThreadRecords(threadId, ["messages"], { messageRoles: ["user", "assistant"] })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "OrchestratorProjectionError" &&
            isProjectionStoreThreadNotFoundError(error.cause)
              ? notFound
              : error,
          ),
        );
      if (projection.thread.deletedAt !== null) return yield* notFound;
      const project = yield* projects.get(projection.thread.projectId);
      if (Option.isNone(project)) {
        return yield* new ThreadSummaryError({
          reason: "failed",
          detail: "This thread's project no longer exists.",
        });
      }
      const inherited = yield* inheritedMessages(projection.thread);
      const context = formatThreadTitleContext(
        [...inherited, ...projection.messages].filter((message) => !message.streaming),
        { context: THREAD_SUMMARY_TRANSCRIPT_LIMIT, message: MESSAGE_LIMIT },
      );
      if (context.message.length === 0) {
        return yield* new ThreadSummaryError({
          reason: "empty",
          detail: "This thread has no messages to summarize yet.",
        });
      }
      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        projection.thread.projectId,
      ).settings;
      const modelSelection = ServerSettings.resolveThreadSummaryModelSelection(
        settings,
        yield* providerRegistry.getProviders,
        projection.thread.projectId,
      );
      // Storage cleanup removes worktrees but keeps the path; CLIs cannot spawn in a missing cwd.
      const worktreePath = projection.thread.worktreePath;
      const worktreeExists =
        worktreePath !== null &&
        (yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => false)));
      const generated = yield* textGeneration.generateThreadSummary({
        cwd: worktreeExists ? worktreePath : project.value.workspaceRoot,
        threadTitle: projection.thread.title,
        transcript: context.message,
        projectTitle: project.value.title,
        instructions: settings.threadSummaryInstructions,
        modelSelection,
        projectId: projection.thread.projectId,
      });
      const summary: ThreadSummary = {
        threadId,
        markdown: generated.summary,
        modelSelection,
        generatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      yield* summaries.put(summary);
      return summary;
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.tapError((error) =>
          isThreadSummaryError(error)
            ? Effect.void
            : Effect.logWarning("Thread summary generation failed", { threadId, cause: error }),
        ),
        Effect.mapError((error) =>
          isThreadSummaryError(error)
            ? error
            : new ThreadSummaryError({
                reason: "failed",
                detail: failureDetail(error),
                cause: error,
              }),
        ),
      ),
  );

  const get: ThreadSummaryService["Service"]["get"] = Effect.fn("ThreadSummaryService.get")(
    function* (threadId) {
      const summary = yield* summaries.get(threadId).pipe(
        Effect.mapError(
          (cause) =>
            new ThreadSummaryError({
              reason: "failed",
              detail: "Could not read the stored summary.",
              cause,
            }),
        ),
      );
      return { summary: Option.getOrNull(summary), generating: inFlight.has(threadId) };
    },
  );

  const generate: ThreadSummaryService["Service"]["generate"] = Effect.fn(
    "ThreadSummaryService.generate",
  )(function* (threadId) {
    const claim = yield* Effect.sync(() => {
      const existing = inFlight.get(threadId);
      if (existing !== undefined) return { deferred: existing, started: false };
      const deferred = Deferred.makeUnsafe<ThreadSummary, ThreadSummaryError>();
      inFlight.set(threadId, deferred);
      return { deferred, started: true };
    });
    if (claim.started) {
      // Runs in the service scope so a closed modal or dropped socket does not waste the model call.
      yield* write(threadId).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => inFlight.delete(threadId)).pipe(
            Effect.andThen(Deferred.done(claim.deferred, exit)),
          ),
        ),
        Effect.forkIn(serviceScope),
      );
    }
    return yield* Deferred.await(claim.deferred);
  });

  return ThreadSummaryService.of({ get, generate });
});

export const layer = Layer.effect(ThreadSummaryService, make);
