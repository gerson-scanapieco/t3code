import { useAtomValue } from "@effect/atom-react";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatModelSelectionEffort } from "@t3tools/client-runtime/state/thread-execution";
import { resolveThreadSummaryPresentation } from "@t3tools/client-runtime/state/thread-summaries";
import type { ScopedThreadRef, ThreadSummary } from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { T, useGT } from "gt-react";
import { FileTextIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { threadSummaryEnvironment } from "~/state/threadSummaries";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatFullTimestamp } from "~/timestampFormat";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Skeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";
import { threadSummaryDialogThreadAtom } from "./threadSummaryDialogState";

export function ThreadSummaryDialogHost() {
  const threadRef = useAtomValue(threadSummaryDialogThreadAtom);
  if (threadRef === null) return null;
  return (
    <ThreadSummaryDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(threadSummaryDialogThreadAtom, null)}
    />
  );
}

function ThreadSummaryDialog({
  threadRef,
  onClose,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const thread = useThreadShell(threadRef);
  const query = useEnvironmentQuery(
    threadSummaryEnvironment.summary({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canGenerate = useAtomValue(
    threadSummaryEnvironment.generate.permissionAtom(threadRef.environmentId),
  );
  const generateSummary = useAtomCommand(threadSummaryEnvironment.generate, {
    reportFailure: false,
  });
  const [generating, setGenerating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [generated, setGenerated] = useState<ThreadSummary | null>(null);

  const generate = async () => {
    setGenerating(true);
    setFailure(null);
    const result = await generateSummary({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
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

  const { body, action, error } = resolveThreadSummaryPresentation({
    data: query.data,
    isPending: query.isPending,
    queryError: query.error,
    failure,
    generating,
    canGenerate,
    generated,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <T>Thread summary</T>
          </DialogTitle>
          {thread ? <DialogDescription>{thread.title}</DialogDescription> : null}
        </DialogHeader>
        <DialogPanel>
          {body.kind === "loading" ? (
            <div className="grid gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : body.kind === "summary" ? (
            <div className="grid gap-3">
              <ChatMarkdown
                text={body.summary.markdown}
                cwd={thread?.worktreePath ?? undefined}
                threadRef={threadRef}
                environmentId={threadRef.environmentId}
              />
              <SummaryProvenance environmentId={threadRef.environmentId} summary={body.summary} />
            </div>
          ) : body.kind === "writing" ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner size="sm" />
              <T>Writing a summary…</T>
            </p>
          ) : body.kind === "empty" ? (
            <p className="text-muted-foreground text-sm">
              <T>
                No summary yet. Generate one to see the thread&apos;s goal, what was done, and where
                it stands.
              </T>
            </p>
          ) : null}
          {error !== null ? (
            <p role="alert" className="mt-3 text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            <T context="button that closes the dialog">Close</T>
          </Button>
          {action !== null ? (
            <Button size="sm" onClick={() => void generate()} disabled={action.disabled}>
              {action.kind === "generating" ? (
                <Spinner />
              ) : action.kind === "regenerate" ? (
                <RefreshCwIcon />
              ) : (
                <FileTextIcon />
              )}
              {action.kind === "generating"
                ? gt("Generating…")
                : action.kind === "regenerate"
                  ? gt("Regenerate", { $context: "verb, write the thread summary again" })
                  : gt("Generate summary")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function SummaryProvenance({
  environmentId,
  summary,
}: {
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly summary: ThreadSummary;
}) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const provider = useEnvironmentProviders()
    .get(environmentId)
    ?.find((candidate) => candidate.instanceId === summary.modelSelection.instanceId);
  const model = provider?.models.find(
    (candidate) => candidate.slug === summary.modelSelection.model,
  );
  const effort = formatModelSelectionEffort(summary.modelSelection, provider?.models ?? []);
  const modelLabel = [
    provider ? resolveProviderInstanceDisplayName(provider) : summary.modelSelection.instanceId,
    model?.name ?? formatModelSlugName(summary.modelSelection.model),
    effort,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <p className="text-muted-foreground text-xs">
      {gt("Written by {model} on {time}", {
        model: modelLabel,
        time: formatFullTimestamp(summary.generatedAt, timestampFormat),
      })}
    </p>
  );
}
