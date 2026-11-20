import {
  ClientSettingsPatch,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  ProjectSettingsOverrides,
  ServerSettingsPatch,
  type ClientSettings,
  type ServerSettings,
} from "@t3tools/contracts/settings";
import {
  repositoryGroupingKeyOf,
  type ProjectId,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const SETTINGS_TRANSFER_FORMAT = "t3code-settings";
const SETTINGS_TRANSFER_VERSION = 1;

/** Credentials, paths, devices and connection trust belong to one machine. */
const MACHINE_SERVER_SETTING_KEYS: ReadonlySet<string> = new Set([
  "providerInstances",
  "textGenerators",
  "secretProviders",
  "cloudSpeechCredentials",
  "observability",
  "sourceControlHosts",
  "usageLimitSources",
  "worktreesDirectory",
  "previousWorktreesDirectories",
  "addProjectBaseDirectory",
  "deviceHosts",
  "easDeviceHosts",
  "simlockDeviceHosts",
  "simlockDeviceHostsEnabled",
  "enableDeviceSupport",
  "deviceOnboardingCompleted",
  "environmentIcon",
  "guestSharingEnabled",
  "linkedEnvironmentsEnabled",
  "requireConnectDeviceApproval",
  "compactIdleThreads",
  "projectSettingsOverrides",
  "projectSettingsFolded",
  "projectScriptOverrides",
  "projectAutoPullOverrides",
  "projectAgentBrowserAccessOverrides",
]);
const MACHINE_CLIENT_SETTING_KEYS: ReadonlySet<string> = new Set([
  "voiceMicrophone",
  "voiceMicrophones",
]);
const MACHINE_PROJECT_SETTING_KEYS: ReadonlySet<string> = new Set(["providerInstances"]);

export interface SettingsTransferProject {
  readonly id: ProjectId;
  readonly repositoryIdentity?: RepositoryIdentity | null | undefined;
}

export interface SettingsTransferThemes {
  readonly custom: ReadonlyArray<unknown>;
  readonly preference: string | null;
  readonly appearanceMode: string | null;
}

export interface SettingsTransferFile {
  readonly format: typeof SETTINGS_TRANSFER_FORMAT;
  readonly version: typeof SETTINGS_TRANSFER_VERSION;
  readonly exportedAt: string;
  readonly serverSettings: Readonly<Record<string, unknown>>;
  readonly clientSettings: Readonly<Record<string, unknown>>;
  readonly projects: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly themes: SettingsTransferThemes;
}

const SettingsTransferFileSchema = Schema.Struct({
  format: Schema.Literal(SETTINGS_TRANSFER_FORMAT),
  version: Schema.Literal(SETTINGS_TRANSFER_VERSION),
  exportedAt: Schema.String,
  serverSettings: Schema.Record(Schema.String, Schema.Unknown),
  clientSettings: Schema.Record(Schema.String, Schema.Unknown),
  projects: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
  themes: Schema.Struct({
    custom: Schema.Array(Schema.Unknown),
    preference: Schema.NullOr(Schema.String),
    appearanceMode: Schema.NullOr(Schema.String),
  }),
});

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changedEntries(
  settings: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  excluded: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key, value]) =>
        !excluded.has(key) && value !== undefined && !sameValue(value, defaults[key]),
    ),
  );
}

/** Projects are keyed by repository so they match the same repository on another machine. */
function repositoryKeyOf(project: SettingsTransferProject): string | null {
  return project.repositoryIdentity ? repositoryGroupingKeyOf(project.repositoryIdentity) : null;
}

export function buildSettingsTransferFile(input: {
  readonly serverSettings: ServerSettings;
  readonly clientSettings: ClientSettings;
  readonly projects: ReadonlyArray<SettingsTransferProject>;
  readonly themes: SettingsTransferThemes;
  readonly exportedAt: string;
}): SettingsTransferFile {
  const projects: Record<string, Record<string, unknown>> = {};
  for (const project of input.projects) {
    const key = repositoryKeyOf(project);
    const overrides = input.serverSettings.projectSettingsOverrides[project.id];
    if (key === null || overrides === undefined) continue;
    const portable = changedEntries(overrides, {}, MACHINE_PROJECT_SETTING_KEYS);
    if (Object.keys(portable).length > 0) projects[key] = { ...projects[key], ...portable };
  }
  return {
    format: SETTINGS_TRANSFER_FORMAT,
    version: SETTINGS_TRANSFER_VERSION,
    exportedAt: input.exportedAt,
    serverSettings: changedEntries(
      input.serverSettings,
      DEFAULT_SERVER_SETTINGS,
      MACHINE_SERVER_SETTING_KEYS,
    ),
    clientSettings: changedEntries(
      input.clientSettings,
      DEFAULT_CLIENT_SETTINGS,
      MACHINE_CLIENT_SETTING_KEYS,
    ),
    projects,
    themes: input.themes,
  };
}

const decodeServerSettingsPatch = Schema.decodeUnknownOption(ServerSettingsPatch);
const decodeClientSettingsPatch = Schema.decodeUnknownOption(ClientSettingsPatch);
const decodeProjectSettingsOverrides = Schema.decodeUnknownOption(ProjectSettingsOverrides);
const decodeSettingsTransferFile = Schema.decodeUnknownOption(SettingsTransferFileSchema);

/** Keeps each field that is valid on its own, so one unknown or newer field does not drop the rest. */
function decodeFields(
  decode: (value: unknown) => Option.Option<object>,
  entries: Readonly<Record<string, unknown>>,
  excluded: ReadonlySet<string>,
): { readonly patch: Record<string, unknown>; readonly skipped: ReadonlyArray<string> } {
  const patch: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    const decoded = excluded.has(key) ? Option.none() : decode({ [key]: value });
    if (Option.isSome(decoded) && key in decoded.value) {
      patch[key] = (decoded.value as Record<string, unknown>)[key];
    } else {
      skipped.push(key);
    }
  }
  return { patch, skipped };
}

export type SettingsTransferImport = {
  readonly serverPatch: ServerSettingsPatch;
  readonly clientPatch: ClientSettingsPatch;
  readonly themes: SettingsTransferThemes;
  readonly matchedRepositories: ReadonlyArray<string>;
  readonly unmatchedRepositories: ReadonlyArray<string>;
  readonly skippedFields: ReadonlyArray<string>;
};

export class SettingsTransferFileError extends Schema.TaggedError<SettingsTransferFileError>()(
  "SettingsTransferFileError",
  { message: Schema.String },
) {}

export function parseSettingsTransferFile(text: string): SettingsTransferFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SettingsTransferFileError({ message: "The file is not valid JSON." });
  }
  const decoded = decodeSettingsTransferFile(value);
  if (Option.isNone(decoded)) {
    throw new SettingsTransferFileError({
      message: "The file is not a T3 Code settings export.",
    });
  }
  return decoded.value;
}

export function planSettingsTransferImport(input: {
  readonly file: SettingsTransferFile;
  readonly serverSettings: ServerSettings;
  readonly projects: ReadonlyArray<SettingsTransferProject>;
}): SettingsTransferImport {
  const serverPatch = decodeFields(
    decodeServerSettingsPatch,
    input.file.serverSettings,
    MACHINE_SERVER_SETTING_KEYS,
  );
  const clientPatch = decodeFields(
    decodeClientSettingsPatch,
    input.file.clientSettings,
    MACHINE_CLIENT_SETTING_KEYS,
  );
  const skippedFields = [...serverPatch.skipped, ...clientPatch.skipped];
  const projectOverrides: Record<string, ProjectSettingsOverrides> = {};
  const matchedRepositories: string[] = [];
  const unmatchedRepositories: string[] = [];
  for (const [repository, entries] of Object.entries(input.file.projects)) {
    const members = input.projects.filter((project) => repositoryKeyOf(project) === repository);
    if (members.length === 0) {
      unmatchedRepositories.push(repository);
      continue;
    }
    matchedRepositories.push(repository);
    const decoded = decodeFields(
      decodeProjectSettingsOverrides,
      entries,
      MACHINE_PROJECT_SETTING_KEYS,
    );
    skippedFields.push(...decoded.skipped.map((key) => `${repository}: ${key}`));
    for (const project of members) {
      projectOverrides[project.id] = {
        ...input.serverSettings.projectSettingsOverrides[project.id],
        ...(decoded.patch as ProjectSettingsOverrides),
      };
    }
  }
  return {
    serverPatch: {
      ...(serverPatch.patch as ServerSettingsPatch),
      ...(Object.keys(projectOverrides).length > 0
        ? { projectSettingsOverrides: projectOverrides }
        : {}),
    },
    clientPatch: clientPatch.patch as ClientSettingsPatch,
    themes: input.file.themes,
    matchedRepositories,
    unmatchedRepositories,
    skippedFields,
  };
}
