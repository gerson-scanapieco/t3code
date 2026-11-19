import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { explicitBareRepositoryEnv, unsetInheritedRepositoryEnv } from "../vcs/VcsProcess.ts";

const parseGitfileTarget = (contents: string): string | undefined => {
  const firstLine = contents.split(/\r?\n/u, 1)[0] ?? "";
  if (!firstLine.startsWith("gitdir:")) return undefined;
  const target = firstLine.slice("gitdir:".length).trim();
  return target === "" ? undefined : target;
};

const splitNul = (stdout: string) => stdout.split("\0").filter((entry) => entry !== "");

export interface WorktreeContainer {
  /** The worktree inside the folder with the repository's default branch checked out. */
  readonly defaultCheckout: string | null;
}

/**
 * Whether a folder only holds a repository's metadata and worktrees: its `.git` file points at
 * metadata inside it, a linked worktree lives inside it, and either the repository is bare or it
 * has commits but no index. A checkout whose tracked files are all deleted keeps its index, and a
 * fresh one has no commit. Anything this cannot establish answers null.
 */
export const makeReadWorktreeContainer = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const env = {
    ...unsetInheritedRepositoryEnv(process.env, platform),
    ...explicitBareRepositoryEnv(process.env, platform),
  };

  const realPath = (target: string) => fileSystem.realPath(target).pipe(Effect.option);
  const isInside = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };

  return Effect.fn("ProjectService.readWorktreeContainer")(function* (
    workspaceRoot: string,
  ): Effect.fn.Return<WorktreeContainer | null> {
    // A `.git` directory is an ordinary checkout, so only a gitfile costs any Git process.
    const gitfileTarget = yield* fileSystem.readFileString(path.join(workspaceRoot, ".git")).pipe(
      Effect.map(parseGitfileTarget),
      Effect.orElseSucceed(() => undefined),
    );
    if (gitfileTarget === undefined) return null;
    const root = yield* realPath(workspaceRoot);
    const gitDir = yield* realPath(path.resolve(workspaceRoot, gitfileTarget));
    if (root._tag === "None" || gitDir._tag === "None") return null;
    if (!isInside(root.value, gitDir.value)) return null;

    const git = (args: ReadonlyArray<string>) =>
      processRunner
        .run({
          command: "git",
          args: ["-C", workspaceRoot, ...args],
          env,
          timeoutBehavior: "timedOutResult",
        })
        .pipe(
          Effect.map((result) => (result.code === 0 && !result.timedOut ? result.stdout : null)),
          Effect.orElseSucceed(() => null),
        );

    // Initializing Git in a bare container clears core.bare, so it is refused while still bare.
    const isBare = yield* git(["rev-parse", "--is-bare-repository"]);
    if (isBare === null) return null;
    if (isBare.trim() !== "true") {
      const hasCommit = yield* git(["rev-parse", "--quiet", "--verify", "HEAD^{commit}"]);
      if (hasCommit === null) return null;
      const hasIndex = yield* fileSystem
        .exists(path.join(gitDir.value, "index"))
        .pipe(Effect.orElseSucceed(() => true));
      if (hasIndex) return null;
    }

    const worktrees = yield* git(["worktree", "list", "--porcelain", "-z"]);
    if (worktrees === null) return null;
    // Records start at "worktree <path>"; the first is the main worktree, which Git reports as
    // the metadata directory here.
    const linkedWorktrees: Array<{ path: string; branch: string | null }> = [];
    for (const field of splitNul(worktrees)) {
      if (field.startsWith("worktree ")) {
        linkedWorktrees.push({ path: field.slice("worktree ".length), branch: null });
      } else if (field.startsWith("branch ") && linkedWorktrees.length > 0) {
        linkedWorktrees[linkedWorktrees.length - 1]!.branch = field.slice("branch ".length);
      }
    }
    const inside: Array<{ path: string; branch: string | null }> = [];
    for (const entry of linkedWorktrees.slice(1)) {
      const worktree = yield* realPath(entry.path);
      if (worktree._tag === "Some" && isInside(root.value, worktree.value)) inside.push(entry);
    }
    if (inside.length === 0) return null;
    const head = yield* git(["symbolic-ref", "--quiet", "HEAD"]);
    const defaultBranch = head?.trim() ?? null;
    return {
      defaultCheckout: inside.find((entry) => entry.branch === defaultBranch)?.path ?? null,
    };
  });
});
