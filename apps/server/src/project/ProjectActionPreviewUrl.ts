import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  PreviewActionUrlEnvFileReadError,
  PreviewActionUrlVariablesMissingError,
  type PreviewResolveActionUrlInput,
  type PreviewResolveActionUrlResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  hasPreviewUrlPlaceholders,
  parseDotenv,
  PREVIEW_URL_ENV_FILE,
  substitutePreviewUrl,
} from "@t3tools/shared/previewUrlTemplate";

import { shouldExcludeTerminalEnvKey } from "../terminal/Manager.ts";

export class ProjectActionPreviewUrl extends Context.Service<
  ProjectActionPreviewUrl,
  {
    /**
     * Fills `${NAME}` from `.env.local` in `cwd`, then the action's runtime env, then the server
     * env the action's terminal inherits. URLs without placeholders return without any I/O.
     */
    readonly resolve: (
      input: PreviewResolveActionUrlInput,
    ) => Effect.Effect<
      PreviewResolveActionUrlResult,
      PreviewActionUrlVariablesMissingError | PreviewActionUrlEnvFileReadError
    >;
  }
>()("t3/project/ProjectActionPreviewUrl") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const resolve: ProjectActionPreviewUrl["Service"]["resolve"] = Effect.fn(
    "ProjectActionPreviewUrl.resolve",
  )(function* (input) {
    if (!hasPreviewUrlPlaceholders(input.url)) return { url: input.url };
    const envFilePath = path.join(input.cwd, PREVIEW_URL_ENV_FILE);
    const envFile = yield* fileSystem.readFileString(envFilePath).pipe(
      Effect.map(parseDotenv),
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(new Map<string, string>())
            : Effect.fail(new PreviewActionUrlEnvFileReadError({ envFilePath, cause })),
      }),
    );
    const hostEnv = yield* HostProcess.Environment;
    const result = substitutePreviewUrl(
      input.url,
      (name) =>
        envFile.get(name) ??
        input.env?.[name] ??
        (shouldExcludeTerminalEnvKey(name) ? undefined : hostEnv[name]),
    );
    if (result._tag === "Missing") {
      return yield* new PreviewActionUrlVariablesMissingError({
        variables: result.variables,
        envFilePath,
      });
    }
    return { url: result.url };
  });

  return ProjectActionPreviewUrl.of({ resolve });
});

export const layer = Layer.effect(ProjectActionPreviewUrl, make);
