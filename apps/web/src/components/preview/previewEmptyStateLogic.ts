import type { ProjectScript } from "@t3tools/contracts";
import { hasPreviewUrlPlaceholders } from "@t3tools/shared/previewUrlTemplate";

// Placeholder URLs only have an address once an action resolves them for its worktree.
export function getConfiguredPreviewUrls(
  scripts: ReadonlyArray<ProjectScript> | undefined,
): ReadonlyArray<string> {
  return (
    scripts?.flatMap((script) =>
      script.previewUrl && !hasPreviewUrlPlaceholders(script.previewUrl) ? [script.previewUrl] : [],
    ) ?? []
  );
}
