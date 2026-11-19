import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ProjectActionPreviewUrl from "./ProjectActionPreviewUrl.ts";

const layerTest = ProjectActionPreviewUrl.layer.pipe(Layer.provideMerge(NodeServices.layer));

const makeWorktree = Effect.fn("makeWorktree")(function* (envLocal?: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-preview-url-" });
  if (envLocal !== undefined) {
    yield* fileSystem.writeFileString(path.join(cwd, ".env.local"), envLocal);
  }
  return { cwd, envFilePath: path.join(cwd, ".env.local") };
});

const resolve = (
  input: Parameters<ProjectActionPreviewUrl.ProjectActionPreviewUrl["Service"]["resolve"]>[0],
) =>
  Effect.flatMap(ProjectActionPreviewUrl.ProjectActionPreviewUrl, (service) =>
    service.resolve(input),
  ).pipe(
    Effect.provideService(HostProcess.Environment, {
      PORT: "8080",
      SERVER_HOST: "server.test",
      BASE: "from-server",
      T3CODE_HOME: "/secret",
    }),
  );

it.layer(layerTest)("ProjectActionPreviewUrl", (it) => {
  describe("resolve", () => {
    it.effect("prefers the worktree's .env.local, then the action env, then the server env", () =>
      Effect.gen(function* () {
        const { cwd } = yield* makeWorktree("PORT=3103\nAPP_PATH=from-file\nBASE=\n");
        const result = yield* resolve({
          cwd,
          url: "http://${SERVER_HOST}:${PORT}/${APP_PATH}/${BASE}",
          env: { APP_PATH: "from-env", BASE: "base" },
        });
        expect(result.url).toBe("http://server.test:3103/from-file/base");
      }),
    );

    it.effect("names the missing variables and the file it checked", () =>
      Effect.gen(function* () {
        const { cwd, envFilePath } = yield* makeWorktree();
        const error = yield* resolve({
          cwd,
          url: "http://127.0.0.1:${PORT}/${T3CODE_HOME}",
        }).pipe(Effect.flip);
        expect(error._tag).toBe("PreviewActionUrlVariablesMissingError");
        if (error._tag !== "PreviewActionUrlVariablesMissingError") return;
        // The terminal does not inherit the server's PORT or T3CODE_* variables, so neither may fill a URL.
        expect(error.variables).toEqual(["PORT", "T3CODE_HOME"]);
        expect(error.envFilePath).toBe(envFilePath);
      }),
    );

    it.effect("returns URLs without placeholders as written, even from a missing directory", () =>
      Effect.gen(function* () {
        const result = yield* resolve({
          cwd: "/definitely/not/a/real/t3code/dir",
          url: "http://localhost:5173/$PORT",
        });
        expect(result.url).toBe("http://localhost:5173/$PORT");
      }),
    );
  });
});
