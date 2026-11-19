import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatModelSelectionEffort } from "@t3tools/client-runtime/state/thread-execution";
import { resolveThreadSummaryPresentation } from "@t3tools/client-runtime/state/thread-summaries";
import type { EnvironmentId, ThreadId, ThreadSummary } from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { msg, T, useGT, useMessages } from "gt-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { resolveMarkdownLinkPresentation } from "../../lib/markdownLinks";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useEnvironmentServerConfig, useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadSummaryEnvironment } from "../../state/threadSummaries";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";

const TITLE = msg("Thread summary");
const GENERATED_AT_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

type ThreadSummaryTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

export function ThreadSummarySheet({ route }: StaticScreenProps<ThreadSummaryTarget>) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const markdownStyles = useMarkdownPreviewStyles();
  const { environmentId, threadId } = route.params;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const thread = useThreadShell(threadRef);
  const query = useEnvironmentQuery(
    threadSummaryEnvironment.summary({ environmentId, input: { threadId } }),
  );
  const canGenerate = useAtomValue(threadSummaryEnvironment.generate.permissionAtom(environmentId));
  const generateSummary = useAtomCommand(threadSummaryEnvironment.generate, {
    reportFailure: false,
  });
  const [generating, setGenerating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [generated, setGenerated] = useState<ThreadSummary | null>(null);

  const generate = async () => {
    setGenerating(true);
    setFailure(null);
    const result = await generateSummary({ environmentId, input: { threadId } });
    setGenerating(false);
    if (result._tag === "Success") {
      setGenerated(result.value);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    setFailure(error instanceof Error ? error.message : gt("The summary could not be written."));
  };

  const joinedRun = useRef(false);
  const serverGenerating = query.data?.generating === true;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- joins a run another client started, which the server reports only through this read.
  useEffect(() => {
    if (!serverGenerating || joinedRun.current || !canGenerate) return;
    joinedRun.current = true;
    void generate();
  });

  const presentation = resolveThreadSummaryPresentation({
    data: query.data,
    isPending: query.isPending,
    queryError: query.error,
    failure,
    generating,
    canGenerate,
    generated,
  });
  const { body, action } = presentation;
  const close = () => navigation.goBack();

  const content = (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
      contentContainerClassName="gap-4 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {body.kind === "loading" ? (
        <View className="items-center py-6">
          <AppActivityIndicator colorClassName="accent-icon-muted" />
        </View>
      ) : body.kind === "summary" ? (
        <View className="gap-3">
          <SelectableMarkdownText
            markdown={body.summary.markdown}
            textStyle={markdownStyles.nativeTextStyle}
            onLinkPress={(href) => {
              const link = resolveMarkdownLinkPresentation(href);
              if (link.kind === "external") void tryOpenExternalUrl(link.href, "markdown-link");
            }}
          />
          <SummaryProvenance environmentId={environmentId} summary={body.summary} />
        </View>
      ) : body.kind === "writing" ? (
        <View className="flex-row items-center gap-2">
          <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
          <Text className="text-sm text-foreground-muted">
            <T>Writing a summary…</T>
          </Text>
        </View>
      ) : body.kind === "empty" ? (
        <Text className="text-sm leading-normal text-foreground-secondary">
          <T>
            No summary yet. Generate one to see the thread's goal, what was done, and where it
            stands.
          </T>
        </Text>
      ) : null}
      {presentation.error !== null ? (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {presentation.error}
        </Text>
      ) : null}
      {action !== null ? (
        <Button
          label={
            action.kind === "generating"
              ? gt("Generating…")
              : action.kind === "regenerate"
                ? gt("Regenerate", { $context: "verb, write the thread summary again" })
                : gt("Generate summary")
          }
          icon={action.kind === "regenerate" ? "arrow.clockwise" : "doc.text"}
          tone="primary"
          fullWidth
          loading={action.kind === "generating"}
          disabled={action.disabled}
          onPress={() => void generate()}
        />
      ) : null}
    </ScrollView>
  );

  if (Platform.OS === "ios") {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <SheetHeader
          presentation="native"
          title={m(TITLE)}
          subtitle={thread?.title}
          onClose={close}
        />
        {content}
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-header">
      <NativeStackScreenOptions options={{ sheetCornerRadius: 28 }} />
      <AppBar sheet title={m(TITLE)} subtitle={thread?.title} hideBottomBorder onBack={close} />
      <ScreenContent>{content}</ScreenContent>
    </View>
  );
}

function SummaryProvenance(props: {
  readonly environmentId: EnvironmentId;
  readonly summary: ThreadSummary;
}) {
  const gt = useGT();
  const { modelSelection } = props.summary;
  const provider = useEnvironmentServerConfig(props.environmentId)?.providers.find(
    (candidate) => candidate.instanceId === modelSelection.instanceId,
  );
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection.model);
  const modelLabel = [
    provider ? resolveProviderInstanceDisplayName(provider) : modelSelection.instanceId,
    model?.name ?? formatModelSlugName(modelSelection.model),
    formatModelSelectionEffort(modelSelection, provider?.models ?? []),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Text className="text-xs text-foreground-muted">
      {gt("Written by {model} on {time}", {
        model: modelLabel,
        time: new Date(props.summary.generatedAt).toLocaleString(undefined, GENERATED_AT_FORMAT),
      })}
    </Text>
  );
}
