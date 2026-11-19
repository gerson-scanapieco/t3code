import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitManager from "./GitManager.ts";
import * as GitWorkflowService from "./GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";

const workflowLayer = (
  projectScripts: Layer.Layer<ProjectSetupScriptRunner.ProjectSetupScriptRunner>,
) =>
  GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        resolve: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
      }),
    ),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
    Layer.provide(projectScripts),
    Layer.provideMerge(GitVcsDriver.layer),
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-ref-named-" }).pipe(
        Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("GitWorkflowService", (it) => {
  it.effect("finds a name among the refs of every namespace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-ref-named-" });
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["update-ref", "refs/remotes/upstream/feature/topic", "HEAD"],
        ["symbolic-ref", "refs/remotes/origin/alias", "refs/heads/main"],
        ["update-ref", "refs/mirror/origin/mirrored", "HEAD"],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }
      const found = yield* Effect.forEach(
        ["main", "feature/topic", "alias", "mirrored", "t3/renamed", "feature/*"],
        (refName) => workflow.hasRefNamed({ cwd, refName }),
      );
      assert.deepEqual(found, [true, true, true, true, false, false]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        workflowLayer(Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({})),
      ),
    ),
  );
  it.effect("runs the project's delete script in the worktree before removing it", () => {
    const runs: Array<{
      readonly input: ProjectSetupScriptRunner.ProjectWorktreeDeleteScriptInput;
      readonly worktreeExisted: boolean;
    }> = [];
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.realPath(
        yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-remove-worktree-" }),
      );
      const cwd = `${root}/repo`;
      const worktreePath = `${root}/feature`;
      yield* fileSystem.makeDirectory(cwd);
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["worktree", "add", "-b", "feature", worktreePath],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }
      yield* workflow.removeWorktree({ cwd, path: worktreePath, force: true });
      assert.deepEqual(runs, [{ input: { projectCwd: cwd, worktreePath }, worktreeExisted: true }]);
      assert.isFalse(yield* fileSystem.exists(worktreePath));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        workflowLayer(
          Layer.effect(
            ProjectSetupScriptRunner.ProjectSetupScriptRunner,
            Effect.gen(function* () {
              const fileSystem = yield* FileSystem.FileSystem;
              return ProjectSetupScriptRunner.ProjectSetupScriptRunner.of({
                runForThread: () => Effect.die("unused"),
                runOnWorktreeDelete: (input) =>
                  fileSystem.exists(input.worktreePath).pipe(
                    Effect.orDie,
                    Effect.map((worktreeExisted) => {
                      runs.push({ input, worktreeExisted });
                      return { status: "no-script" } as const;
                    }),
                  ),
              });
            }),
          ).pipe(Layer.provide(NodeServices.layer)),
        ),
      ),
    );
  });
  it.effect("keeps the worktree when the delete script fails, unless rolling back", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.realPath(
        yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-remove-worktree-" }),
      );
      const cwd = `${root}/repo`;
      const worktreePath = `${root}/feature`;
      yield* fileSystem.makeDirectory(cwd);
      const workflow = yield* GitWorkflowService.GitWorkflowService;
      const driver = yield* GitVcsDriver.GitVcsDriver;
      for (const args of [
        ["init", "-b", "main"],
        ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
        ["worktree", "add", "-b", "feature", worktreePath],
      ]) {
        yield* driver.execute({ operation: "test.setupRepo", cwd, args });
      }
      const error = yield* workflow
        .removeWorktree({ cwd, path: worktreePath, force: true })
        .pipe(Effect.flip);
      assert.equal(error._tag, "GitCommandError");
      assert.include(
        error.message,
        'Delete action "Teardown" exited with code 1: stack still up. The worktree was kept.',
      );
      assert.isTrue(yield* fileSystem.exists(worktreePath));
      yield* workflow.removeWorktree({ cwd, path: worktreePath, force: true }, { rollback: true });
      assert.isFalse(yield* fileSystem.exists(worktreePath));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        workflowLayer(
          Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
            runOnWorktreeDelete: (input) =>
              Effect.fail(
                new ProjectSetupScriptRunner.ProjectWorktreeDeleteScriptError({
                  scriptName: "Teardown",
                  command: "exit 1",
                  worktreePath: input.worktreePath,
                  exitCode: 1,
                  timedOut: false,
                  output: "stopping\nstack still up\n",
                }),
              ),
          }),
        ),
      ),
    ),
  );
});
