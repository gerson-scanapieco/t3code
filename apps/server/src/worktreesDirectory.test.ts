import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { branchFolderName, resolveProjectWorktreesDirectory } from "./worktreesDirectory.ts";

it.layer(NodeServices.layer)("worktreesDirectory", (it) => {
  it.effect("resolves a project's worktree folder against the repository's Git folder", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const base = path.resolve("/src/sazzi");
      const home = path.resolve("/home/me");
      const resolve = (directory: string) =>
        resolveProjectWorktreesDirectory(directory, base, path, home);
      assert.equal(resolve("."), base);
      assert.equal(resolve("../sazzi-worktrees"), path.resolve("/src/sazzi-worktrees"));
      assert.equal(resolve("~/worktrees"), path.join(home, "worktrees"));
      assert.equal(resolve("/elsewhere/./trees"), path.resolve("/elsewhere/trees"));
      assert.isNull(resolve("../../.."));
      if (path.sep === "/") assert.isNull(resolve("C:\\worktrees"));
    }),
  );
});

it("names branch folders after the branch, safe on every platform", () => {
  assert.equal(branchFolderName("SAZ-90"), "SAZ-90");
  assert.equal(branchFolderName("feature/login"), "feature-login");
  assert.equal(branchFolderName('odd:"name"|x'), "odd--name--x");
  assert.isAtMost(Buffer.byteLength(branchFolderName(`feature/${"界".repeat(80)}`)), 100);
});
