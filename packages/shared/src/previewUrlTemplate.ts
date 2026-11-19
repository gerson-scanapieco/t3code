const PLACEHOLDER_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const ENV_LINE_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

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

/** Reads `KEY=VALUE` lines as data; never expands or executes anything. Later keys win. */
export function parseDotenv(contents: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of contents.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = ENV_LINE_PATTERN.exec(line);
    if (!match) continue;
    const value = parseDotenvValue(match[2]!);
    if (value !== null) values.set(match[1]!, value);
  }
  return values;
}

function parseDotenvValue(raw: string): string | null {
  if (raw.startsWith("'")) {
    const end = raw.indexOf("'", 1);
    return end === -1 ? null : raw.slice(1, end);
  }
  if (raw.startsWith('"')) {
    let end = 1;
    while (end < raw.length && raw[end] !== '"') end += raw[end] === "\\" ? 2 : 1;
    if (end >= raw.length) return null;
    return raw
      .slice(1, end)
      .replace(/\\(.)/g, (_match, char: string) => (char === "n" ? "\n" : char));
  }
  const commentStart = raw.search(/\s#/);
  return (commentStart === -1 ? raw : raw.slice(0, commentStart)).trim();
}
