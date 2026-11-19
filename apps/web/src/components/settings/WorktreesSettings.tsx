import {
  PROJECT_FILE_BACKED_SETTINGS,
  type WorktreeFolderNaming,
  type WorktreeLocation,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { resolvePastedPath } from "@t3tools/shared/path";
import { useGT } from "gt-react";
import { useRef } from "react";

import { AdvancedSettings } from "./AdvancedSettings";
import { BranchNamingSettings } from "./BranchNamingSettings";
import { WorktreeSubmodulesRow } from "./ProjectDefaultsSettings";
import { ScopedSwitch } from "./ScopedSwitch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { WorktreeCleanupSection, WorktreesDirectoryRow } from "./StorageSettings";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function StartFromRemoteRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      settingKeys={["newWorktreesStartFromOrigin"]}
      {...searchableSetting("start-from-origin")}
      description={gt(
        "Uses the latest commit of the base branch’s tracked remote branch, even if its name differs. Otherwise uses the same-named branch on origin. Uses your local branch if that remote branch is missing.",
      )}
      resetAction={
        settings.newWorktreesStartFromOrigin !==
        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
          <SettingResetButton
            ariaLabel={gt("Reset new worktrees start from remote to default")}
            onClick={() =>
              updateSettings({
                newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
              })
            }
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={["newWorktreesStartFromOrigin"]}
          checked={settings.newWorktreesStartFromOrigin}
          onCheckedChange={(checked) =>
            updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
          }
          aria-label={gt("Start new worktrees from remote by default")}
        />
      }
    />
  );
}

const isWorktreeFolderNaming = (value: unknown): value is WorktreeFolderNaming =>
  value === "branch" || value === "hashed";

function ProjectWorktreeLocationRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const { targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["worktreeLocation"]);
  const edited = useRef(false);
  const draft = useRef("");
  const location: WorktreeLocation =
    settings.worktreeLocation ?? PROJECT_FILE_BACKED_SETTINGS.worktreeLocation.builtIn;
  const save = (patch: Partial<WorktreeLocation>) =>
    updateSettings({ worktreeLocation: { ...location, ...patch } });
  const scopeKey = targets.map((target) => target.projectId ?? target.environmentId).join(",");

  return (
    <SettingsRow
      serverScoped
      settingKeys={["worktreeLocation"]}
      mixed={mixed}
      {...searchableSetting("project-worktree-location")}
      description={gt(
        "Folder for this project's new worktrees, and how each one is named. A relative path starts from the folder that holds the repository's Git data: the checkout of an ordinary clone, or the folder around a bare repository such as .bare, where . puts worktrees beside the others. Leave empty to use the T3 worktree folder. Existing folders are never reused.",
      )}
      control={
        <div className="flex items-center gap-2">
          <Input
            key={`${scopeKey}:${mixed}:${location.directory}`}
            aria-label={gt("Worktree folder")}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={mixed ? gt("Mixed") : gt("T3 worktree folder")}
            defaultValue={mixed ? "" : location.directory}
            onFocus={(event) => {
              draft.current = event.target.value;
            }}
            onChange={(event) => {
              edited.current = true;
              draft.current = resolvePastedPath(draft.current, event.target.value);
              event.target.value = draft.current;
            }}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (edited.current && (mixed || value !== location.directory))
                save({ directory: value });
              edited.current = false;
            }}
          />
          <Select
            value={mixed ? null : location.naming}
            onValueChange={(value) => {
              if (isWorktreeFolderNaming(value)) save({ naming: value });
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("Worktree folder names")}>
              <SelectValue>
                {(value: string | null) =>
                  value === "branch"
                    ? gt("Branch name")
                    : value === "hashed"
                      ? gt("Branch name and ID")
                      : gt("Mixed", { $context: "values differ across targets" })
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="branch">{gt("Branch name")}</SelectItem>
              <SelectItem value="hashed">{gt("Branch name and ID")}</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}

export function WorktreesSettingsPanel() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const { scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="worktree-creation"
        title={gt("Creation", { $context: "settings section about creating worktrees" })}
      >
        {isProjectScope ? <ProjectWorktreeLocationRow /> : <WorktreesDirectoryRow />}
        <StartFromRemoteRow />
        <AdvancedSettings targetIds={[searchableSetting("worktree-submodules").id]}>
          <WorktreeSubmodulesRow />
        </AdvancedSettings>
      </SettingsSection>
      <SettingsSection id="worktree-branches" title={gt("Branches")}>
        <BranchNamingSettings />
      </SettingsSection>
      <WorktreeCleanupSection />
    </SettingsPageContainer>
  );
}
