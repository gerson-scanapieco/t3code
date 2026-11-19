import { useNavigate } from "@tanstack/react-router";
import type { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection, pickModelSelection } from "@t3tools/shared/model";
import { resolveThreadSummaryModelSelection } from "@t3tools/shared/serverSettings";
import { T, useGT } from "gt-react";
import { useRef } from "react";

import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useTextGenerationTargets } from "../../textGenerators";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
} from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function ThreadSummaryModelSettings() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments, target } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const mixed = useScopedSettingsMixed(["threadSummaryModelSelection"]);
  const projectId = target?.projectId ?? null;

  const targets = useTextGenerationTargets({
    environmentId,
    settings,
    providers: serverProviders.filter((provider) => provider.supportsTextGeneration !== false),
    projectId,
    selections: [settings.threadSummaryModelSelection, settings.textGenerationModelSelection],
  });
  const entries = targets.entries;
  const enabledInstanceIds = new Set(
    entries.filter((entry) => entry.enabled && entry.isAvailable).map((entry) => entry.instanceId),
  );
  const providers = targets.providers.filter((provider) =>
    enabledInstanceIds.has(provider.instanceId),
  );
  const defaultSelection = resolveAppModelSelectionState(settings, providers);
  const usesDedicatedModel = settings.threadSummaryModelSelection !== null;
  const activeSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveThreadSummaryModelSelection(
        settings,
        providers,
        projectId,
      ),
    },
    providers,
  );
  const canEnableDedicatedModel = entries.some(
    (entry) =>
      entry.instanceId === defaultSelection.instanceId && entry.enabled && entry.isAvailable,
  );
  const modelOptionsByInstance = getTextGenerationModelOptionsByInstance(
    settings,
    providers,
    activeSelection.instanceId,
    activeSelection.model,
  );
  const disabledReason = useScopedModelDisabledReason(settings, entries, true);
  const instanceEntry = entries.find((entry) => entry.instanceId === activeSelection.instanceId);
  const rejected = (reason: string) =>
    toastManager.add({
      type: "error",
      title: gt("Thread summary model not saved"),
      description: reason,
    });

  return (
    <SettingsRow
      serverScoped
      settingKeys={["threadSummaryModelSelection"]}
      {...setting("thread-summary-model")}
      description={gt(
        "Model for thread summaries. When disabled, summaries use the text generation model.",
      )}
      control={
        !hasServerTargets ? (
          <span className="text-sm text-muted-foreground">
            <T>Connect an environment to choose its thread summary model.</T>
          </span>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {usesDedicatedModel && !canEnableDedicatedModel ? (
              <span className="text-sm text-muted-foreground">
                <T>No text generation providers available.</T>
              </span>
            ) : null}
            {usesDedicatedModel && canEnableDedicatedModel ? (
              <ProviderModelPicker
                environmentId={environmentId}
                activeInstanceId={activeSelection.instanceId}
                model={activeSelection.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel={gt("Thread summary model")}
                {...(mixed ? { triggerLabel: gt("Mixed") } : {})}
                {...(environmentId
                  ? {
                      onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                        void navigate({
                          to: "/settings/providers",
                          search: { environmentId, instanceId },
                        });
                      },
                    }
                  : {})}
                getModelDisabledReason={disabledReason}
                onInstanceModelChange={(instanceId, model) => {
                  const reason = disabledReason(instanceId, model);
                  if (reason) {
                    rejected(reason);
                    return;
                  }
                  updateSettings({
                    threadSummaryModelSelection: pickModelSelection(
                      mixed ? null : activeSelection,
                      instanceId,
                      model,
                    ),
                  });
                }}
              />
            ) : null}
            {usesDedicatedModel && canEnableDedicatedModel && !mixed && instanceEntry ? (
              <TraitsPicker
                provider={instanceEntry.driverKind}
                models={instanceEntry.models}
                model={activeSelection.model}
                modelOptions={activeSelection.options ?? []}
                allowPromptInjectedEffort={false}
                includePlanAgent={selectsPlanAgent(activeSelection.options)}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  updateSettings({
                    threadSummaryModelSelection: createModelSelection(
                      activeSelection.instanceId,
                      activeSelection.model,
                      options,
                    ),
                  })
                }
              />
            ) : null}
            <Switch
              mixed={mixed}
              checked={mixed ? false : usesDedicatedModel}
              disabled={!usesDedicatedModel && !canEnableDedicatedModel}
              onCheckedChange={(checked) => {
                if (checked) {
                  const reason = disabledReason(
                    defaultSelection.instanceId,
                    defaultSelection.model,
                  );
                  if (reason) {
                    rejected(reason);
                    return;
                  }
                }
                updateSettings({
                  threadSummaryModelSelection: checked
                    ? createModelSelection(
                        defaultSelection.instanceId,
                        defaultSelection.model,
                        defaultSelection.options,
                      )
                    : null,
                });
              }}
              aria-label={gt("Use a separate thread summary model")}
            />
          </div>
        )
      }
    />
  );
}

export function ThreadSummaryInstructionsSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["threadSummaryInstructions"]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["threadSummaryInstructions"]}
      {...searchableSetting("thread-summary-instructions")}
      description={gt("Appended to the prompt when a thread summary is written.")}
      resetAction={
        mixed || settings.threadSummaryInstructions !== "" ? (
          <SettingResetButton
            ariaLabel={gt("Reset thread summary instructions to default")}
            onClick={() => updateSettings({ threadSummaryInstructions: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.threadSummaryInstructions}`}
          aria-label={gt("Thread summary instructions")}
          onChange={() => {
            edited.current = true;
          }}
          rows={4}
          defaultValue={mixed ? "" : settings.threadSummaryInstructions}
          placeholder={
            mixed
              ? gt("Mixed. Enter instructions to apply to all selected targets.")
              : gt("Write one short paragraph. End with the next step.")
          }
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.threadSummaryInstructions))
              updateSettings({ threadSummaryInstructions: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
