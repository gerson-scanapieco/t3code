import { describe, expect, it } from "vite-plus/test";

import {
  hasPreviewUrlPlaceholders,
  parseDotenv,
  previewUrlPlaceholderNames,
  substitutePreviewUrl,
} from "./previewUrlTemplate.ts";

describe("previewUrlPlaceholderNames", () => {
  it("lists each well-formed placeholder once, in order", () => {
    expect(previewUrlPlaceholderNames("http://${HOST}:${PORT}/${PORT}/${_x1}")).toEqual([
      "HOST",
      "PORT",
      "_x1",
    ]);
  });

  it.each([
    "http://localhost:5173",
    "http://$PORT",
    "http://${1PORT}",
    "http://${}",
    "http://${A-B}",
  ])("ignores %s", (url) => {
    expect(hasPreviewUrlPlaceholders(url)).toBe(false);
  });
});

describe("substitutePreviewUrl", () => {
  const lookup = (values: Record<string, string>) => (name: string) => values[name];

  it("replaces every occurrence", () => {
    expect(
      substitutePreviewUrl(
        "http://${HOST}:${PORT}/?p=${PORT}",
        lookup({ HOST: "127.0.0.1", PORT: "3103" }),
      ),
    ).toEqual({ _tag: "Resolved", url: "http://127.0.0.1:3103/?p=3103" });
  });

  it("reports every missing or empty variable instead of a partial URL", () => {
    expect(
      substitutePreviewUrl(
        "http://${HOST}:${PORT}/${BASE}",
        lookup({ HOST: "localhost", PORT: "" }),
      ),
    ).toEqual({ _tag: "Missing", variables: ["PORT", "BASE"] });
  });

  it("returns a URL without placeholders unchanged without looking anything up", () => {
    const calls: string[] = [];
    expect(
      substitutePreviewUrl("http://localhost:5173/$PORT", (name) => {
        calls.push(name);
        return undefined;
      }),
    ).toEqual({ _tag: "Resolved", url: "http://localhost:5173/$PORT" });
    expect(calls).toEqual([]);
  });
});

describe("parseDotenv", () => {
  it("reads assignments, quotes, export prefixes, and comments", () => {
    const values = parseDotenv(
      [
        "﻿# worktree ports",
        "PORT=3103",
        "export HOST = 127.0.0.1",
        "  SPACED=  value with spaces   # trailing comment",
        "HASH=abc#def",
        "SINGLE='literal $HOME # not a comment'",
        'DOUBLE="say \\"hi\\"\\nnext" # comment',
        "EMPTY=",
        "",
        "not a line",
        "1BAD=x",
        'UNTERMINATED="open',
        "PORT=3104",
      ].join("\r\n"),
    );
    expect(Object.fromEntries(values)).toEqual({
      PORT: "3104",
      HOST: "127.0.0.1",
      SPACED: "value with spaces",
      HASH: "abc#def",
      SINGLE: "literal $HOME # not a comment",
      DOUBLE: 'say "hi"\nnext',
      EMPTY: "",
    });
  });

  it("does not expand references or run commands", () => {
    const values = parseDotenv("URL=http://${HOST}:$(whoami)\nCMD=`id`");
    expect(values.get("URL")).toBe("http://${HOST}:$(whoami)");
    expect(values.get("CMD")).toBe("`id`");
  });
});
