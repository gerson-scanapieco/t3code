import { describe, expect, it } from "vite-plus/test";
import type { ProjectId } from "@t3tools/contracts";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  type ServerSettings,
} from "@t3tools/contracts/settings";

import {
  buildSettingsTransferFile,
  parseSettingsTransferFile,
  planSettingsTransferImport,
  SettingsTransferFileError,
} from "./settingsTransfer";

const repository = (canonicalKey: string) => ({
  canonicalKey,
  locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: canonicalKey },
});
const projectId = (id: string) => id as ProjectId;
const themes = { custom: [], preference: null, appearanceMode: null };
const branchNaming = {
  branchNamingMode: "custom",
  branchNameInstructions: "Name the branch after the Linear issue ID.",
} as const;

const exportedServer: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  threadTitleInstructions: "Short titles.",
  worktreesDirectory: "/Users/me/worktrees",
  cloudSpeechCredentials: { openai: "sk-secret", xai: "", openrouter: "" },
  projectSettingsOverrides: {
    [projectId("sazzi-here")]: {
      ...branchNaming,
      worktreeLocation: { directory: ".", naming: "branch" },
    },
    [projectId("no-remote")]: { branchNamePrefix: "x" },
  },
};

const exportFile = () =>
  buildSettingsTransferFile({
    serverSettings: exportedServer,
    clientSettings: { ...DEFAULT_CLIENT_SETTINGS, windowOpacity: 80, voiceMicrophone: "usb-mic" },
    projects: [
      { id: projectId("sazzi-here"), repositoryIdentity: repository("github.com/me/sazzi") },
      { id: projectId("no-remote"), repositoryIdentity: null },
    ],
    themes,
    exportedAt: "2026-11-19T00:00:00.000Z",
  });

describe("settings transfer", () => {
  it("exports changed portable settings and keys projects by repository", () => {
    const file = exportFile();

    expect(file.serverSettings).toEqual({ threadTitleInstructions: "Short titles." });
    expect(file.clientSettings).toEqual({ windowOpacity: 80 });
    expect(file.projects).toEqual({
      "github.com/me/sazzi": {
        ...branchNaming,
        worktreeLocation: { directory: ".", naming: "branch" },
      },
    });
  });

  it("imports into the projects of the same repository and reports the rest", () => {
    const file = parseSettingsTransferFile(
      JSON.stringify({
        ...exportFile(),
        serverSettings: {
          threadTitleInstructions: "Short titles.",
          defaultRuntimeMode: "not-a-mode",
        },
        projects: {
          ...exportFile().projects,
          "github.com/me/elsewhere": { branchNamePrefix: "y" },
        },
      }),
    );
    const sazziThere = projectId("sazzi-there");
    const sazziWorktree = projectId("sazzi-worktree");

    const plan = planSettingsTransferImport({
      file,
      serverSettings: {
        ...DEFAULT_SERVER_SETTINGS,
        projectSettingsOverrides: { [sazziThere]: { branchNamePrefix: "kept" } },
      },
      projects: [
        { id: sazziThere, repositoryIdentity: repository("github.com/me/sazzi") },
        { id: sazziWorktree, repositoryIdentity: repository("github.com/me/sazzi") },
      ],
    });

    expect(plan.serverPatch).toEqual({
      threadTitleInstructions: "Short titles.",
      projectSettingsOverrides: {
        [sazziThere]: {
          branchNamePrefix: "kept",
          ...branchNaming,
          worktreeLocation: { directory: ".", naming: "branch" },
        },
        [sazziWorktree]: {
          ...branchNaming,
          worktreeLocation: { directory: ".", naming: "branch" },
        },
      },
    });
    expect(plan.clientPatch).toEqual({ windowOpacity: 80 });
    expect(plan.matchedRepositories).toEqual(["github.com/me/sazzi"]);
    expect(plan.unmatchedRepositories).toEqual(["github.com/me/elsewhere"]);
    expect(plan.skippedFields).toEqual(["defaultRuntimeMode"]);
  });

  it.each([
    { label: "invalid JSON", text: "{" },
    { label: "another JSON file", text: JSON.stringify({ theme: "dark" }) },
  ])("rejects $label", ({ text }) => {
    expect(() => parseSettingsTransferFile(text)).toThrow(SettingsTransferFileError);
  });
});
