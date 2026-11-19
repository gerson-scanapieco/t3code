const PLACEHOLDER_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export const PREVIEW_URL_ENV_FILE = ".env.local";

export function previewUrlPlaceholderNames(url: string): ReadonlyArray<string> {
  return [...new Set(Array.from(url.matchAll(PLACEHOLDER_PATTERN), (match) => match[1]!))];
}

export function hasPreviewUrlPlaceholders(url: string): boolean {
  return previewUrlPlaceholderNames(url).length > 0;
}

export type PreviewUrlSubstitution =
  | { readonly _tag: "Resolved"; readonly url: string }
  | { readonly _tag: "Missing"; readonly variables: ReadonlyArray<string> };

/** Empty values count as missing: they would only produce a broken URL. */
export function substitutePreviewUrl(
  url: string,
  lookup: (name: string) => string | undefined,
): PreviewUrlSubstitution {
  const missing = previewUrlPlaceholderNames(url).filter((name) => !lookup(name));
  if (missing.length > 0) return { _tag: "Missing", variables: missing };
  return {
    _tag: "Resolved",
    url: url.replace(PLACEHOLDER_PATTERN, (_match, name: string) => lookup(name)!),
  };
}
