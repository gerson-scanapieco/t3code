import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react";
import { useRef, type ChangeEvent } from "react";

import { getClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import {
  readAppearanceModePreference,
  readThemePreference,
  setAppearanceMode,
  setTheme,
} from "../../hooks/useTheme";
import {
  buildSettingsTransferFile,
  parseSettingsTransferFile,
  planSettingsTransferImport,
} from "../../settingsTransfer";
import { readProjects } from "../../state/entities";
import { readEnvironment } from "../../state/environments";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  getCustomThemes,
  installCustomTheme,
  parseThemeFile,
  serializeThemeFile,
  updateCustomTheme,
} from "../../themePalette";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const APPEARANCE_MODES = new Set(["light", "dark", "system"]);

function downloadJsonFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function importThemes(themes: ReadonlyArray<unknown>): number {
  const installed = new Set(getCustomThemes().map((theme) => theme.id));
  let failed = 0;
  for (const value of themes) {
    try {
      const theme = parseThemeFile(value);
      if (installed.has(theme.id)) updateCustomTheme(theme);
      else installCustomTheme(theme);
    } catch {
      failed += 1;
    }
  }
  return failed;
}

export function SettingsBackupSection() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const serverSettings = () =>
    environmentId === null
      ? null
      : (readEnvironment(environmentId)?.serverConfig?.settings ?? null);
  const environmentProjects = () =>
    readProjects().filter(
      (project) => project.environmentId === environmentId && !project.isScratch,
    );
  const unavailable = environmentId === null;

  const exportSettings = () => {
    const server = serverSettings();
    if (server === null) return;
    const preference = readThemePreference();
    const file = buildSettingsTransferFile({
      serverSettings: server,
      clientSettings: getClientSettings(),
      projects: environmentProjects(),
      themes: {
        custom: getCustomThemes().map((theme): unknown => JSON.parse(serializeThemeFile(theme))),
        preference,
        appearanceMode: readAppearanceModePreference(preference),
      },
      exportedAt: new Date().toISOString(),
    });
    downloadJsonFile("t3code-settings.json", `${JSON.stringify(file, null, 2)}\n`);
  };

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const server = serverSettings();
    if (!selected || environmentId === null || server === null) return;
    let plan: ReturnType<typeof planSettingsTransferImport>;
    try {
      plan = planSettingsTransferImport({
        file: parseSettingsTransferFile(await selected.text()),
        serverSettings: server,
        projects: environmentProjects(),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: gt("Settings not imported"),
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const result = await updateServerSettings({
      environmentId,
      input: { patch: plan.serverPatch },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: gt("Settings not imported"),
        description: gt("This environment did not accept the settings."),
      });
      return;
    }
    await persistClientSettingsPatch(plan.clientPatch);
    const failedThemes = importThemes(plan.themes.custom);
    if (plan.themes.preference !== null) setTheme(plan.themes.preference);
    if (plan.themes.appearanceMode !== null && APPEARANCE_MODES.has(plan.themes.appearanceMode)) {
      setAppearanceMode(plan.themes.appearanceMode as "light" | "dark" | "system");
    }
    const notes = [
      ...(plan.unmatchedRepositories.length > 0
        ? [
            gt("Not applied, no matching project here: {repositories}", {
              repositories: plan.unmatchedRepositories.join(", "),
            }),
          ]
        : []),
      ...(plan.skippedFields.length > 0
        ? [gt("Skipped unsupported fields: {fields}", { fields: plan.skippedFields.join(", ") })]
        : []),
      ...(failedThemes > 0 ? [gt("Skipped {count} invalid themes.", { count: failedThemes })] : []),
    ];
    toastManager.add({
      type: notes.length > 0 ? "warning" : "success",
      title: gt("Settings imported"),
      ...(notes.length > 0 ? { description: notes.join("\n") } : {}),
    });
  };

  return (
    <SettingsSection id="backup" title={gt("Backup")}>
      <SettingsRow
        {...setting("settings-export")}
        description={gt(
          "Save your settings, appearance, custom themes and per-project settings to one file. Credentials and machine-specific paths are left out.",
        )}
        control={
          <Button size="sm" variant="outline" disabled={unavailable} onClick={exportSettings}>
            {gt("Export")}
          </Button>
        }
      />
      <SettingsRow
        {...setting("settings-import")}
        description={gt(
          "Apply a settings file. Per-project settings go to the projects of the same repository.",
        )}
        control={
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void importSettings(event)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={unavailable}
              onClick={() => fileInput.current?.click()}
            >
              {gt("Import")}
            </Button>
          </>
        }
      />
    </SettingsSection>
  );
}
