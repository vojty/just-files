// Syntax highlighting with Shiki. Shiki and each language grammar are
// separate chunks, fetched the first time a file needs them.
import type { Highlighter } from "shiki";

/** Longer texts stay plain: highlighting them would block the page for seconds. */
const HIGHLIGHT_LIMIT = 200_000;

const THEMES = { light: "github-light", dark: "github-dark" } as const;

/** File names and extensions Shiki does not know by themselves. */
const LANGUAGE_OF: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  mjs: "js",
  cjs: "js",
  mts: "ts",
  cts: "ts",
  conf: "ini",
  env: "dotenv",
};

let instance: Promise<Highlighter> | undefined;

async function shiki() {
  const lib = await import("shiki");
  instance ??= lib.createHighlighter({
    themes: Object.values(THEMES),
    langs: [],
    // Plain JavaScript regexes instead of Oniguruma's 600 KB WebAssembly.
    engine: lib.createJavaScriptRegexEngine(),
  });
  return { lib, highlighter: await instance };
}

/**
 * Returns code highlighted as the language of the file at path, as HTML in a
 * <pre class="shiki">, or null when the language is unknown or code is too
 * long. Shiki escapes the code, so the HTML is safe to insert.
 */
export async function highlight(path: string, code: string): Promise<string | null> {
  if (code.length > HIGHLIGHT_LIMIT) return null;
  const { lib, highlighter } = await shiki();
  const lower = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  const lang = [LANGUAGE_OF[lower], LANGUAGE_OF[ext], ext].find(
    (l): l is keyof typeof lib.bundledLanguages => !!l && l in lib.bundledLanguages,
  );
  if (!lang) return null;
  await highlighter.loadLanguage(lang);
  return highlighter.codeToHtml(code, { lang, themes: THEMES, defaultColor: "light" });
}
