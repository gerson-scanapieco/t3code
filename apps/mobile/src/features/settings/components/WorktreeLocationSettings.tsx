import { msg, useGT, useMessages } from "gt-react-native";
import {
  PROJECT_FILE_BACKED_SETTINGS,
  type ServerSettingsPatch,
  type WorktreeFolderNaming,
  type WorktreeLocation,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { ListChoiceRow as SettingsChoiceRow } from "../../../components/ui/ListChoiceRow";
import { SettingsSection } from "./SettingsSection";

const NAMING_CHOICES: ReadonlyArray<{
  readonly naming: WorktreeFolderNaming | null;
  readonly label: string;
  readonly description: string;
}> = [
  {
    naming: null,
    label: msg("Inherit", { $context: "use the inherited value" }),
    description: msg("Use the repository's t3.json, or the T3 worktree folder."),
  },
  {
    naming: "hashed",
    label: msg("Branch name and ID"),
    description: msg("Name each folder after its branch, plus a short unique ID."),
  },
  {
    naming: "branch",
    label: msg("Branch name"),
    description: msg("Name each folder after its branch, adding a suffix such as -2 if it exists."),
  },
];

export function WorktreeLocationSettings(props: {
  /** The first target's value; null inherits t3.json. */
  readonly location: WorktreeLocation | null;
  readonly mixed: boolean;
  /** Environments can inherit; a project clears its override from the page instead. */
  readonly inheritable: boolean;
  readonly disabled: boolean;
  readonly trailing?: ReactNode;
  readonly footer?: string;
  readonly onChange: (patch: ServerSettingsPatch) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const shown =
    props.location ??
    (props.inheritable ? null : PROJECT_FILE_BACKED_SETTINGS.worktreeLocation.builtIn);
  const base = shown ?? PROJECT_FILE_BACKED_SETTINGS.worktreeLocation.builtIn;
  // Save on exit too: Android Back hides the keyboard without ending editing.
  const draft = useRef<{ text: string; over: string | undefined } | null>(null);
  const saveDraft = () => {
    const current = draft.current;
    draft.current = null;
    // Drop a draft typed over an older saved value: the updated value has already remounted the input.
    if (current === null || current.over !== shown?.directory) return;
    const directory = current.text.trim();
    if (props.mixed || shown === null || directory !== shown.directory)
      props.onChange({ worktreeLocation: { ...base, directory } });
  };
  const saveOnUnmount = useEffectEvent(saveDraft);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves an unsent worktree folder draft to server settings when the section unmounts
  useEffect(() => () => saveOnUnmount(), []);

  return (
    <SettingsSection
      title={gt("Worktree location")}
      trailing={props.trailing}
      footer={props.footer}
    >
      {NAMING_CHOICES.filter((choice) => choice.naming !== null || props.inheritable).map(
        (choice, index) => (
          <SettingsChoiceRow
            key={choice.naming ?? "inherit"}
            label={m(choice.label)}
            description={m(choice.description)}
            selected={!props.mixed && (shown?.naming ?? null) === choice.naming}
            separated={index > 0}
            disabled={props.disabled}
            onPress={() =>
              props.onChange({
                worktreeLocation:
                  choice.naming === null ? null : { ...base, naming: choice.naming },
              })
            }
          />
        ),
      )}
      {shown !== null || props.mixed ? (
        <View className="gap-2 border-t border-border-subtle px-4 py-3">
          <Text className="text-sm text-foreground-muted">
            {gt(
              "Folder for new worktrees. A relative path starts from the folder that holds the repository's Git data: the checkout of an ordinary clone, or the folder around a bare repository such as .bare, where . puts worktrees beside the others. Leave empty to use the T3 worktree folder. Existing folders are never reused.",
            )}
          </Text>
          <AppTextInput
            key={`${props.mixed}:${shown?.directory}`}
            accessibilityLabel={gt("Worktree folder")}
            onChangeText={(text) => {
              draft.current = { text, over: shown?.directory };
            }}
            defaultValue={props.mixed ? "" : (shown?.directory ?? "")}
            placeholder={props.mixed ? gt("Mixed") : gt("T3 worktree folder")}
            editable={!props.disabled}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            className="min-h-10 rounded-xl px-3 py-2 text-base text-foreground"
            onEndEditing={saveDraft}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
