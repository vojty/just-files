// Vite plugin providing the file icons of Material Icon Theme (the VS Code
// theme): the module "virtual:file-icons" maps file extensions to icon names,
// and the icons are served under /assets/file-icons/<version>/. Only the
// type matters: the theme's icons for particular file names (package.json,
// Dockerfile) and compound extensions (.d.ts) are left out, and folders keep
// the UI's own icon.
import { generateManifest } from "material-icon-theme";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import type { FileIconTheme } from "./ui/src/fileIcons.ts";

const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("material-icon-theme/package.json"));
const { version } = require("material-icon-theme/package.json") as { version: string };
const iconsDir = path.join(pkg, "icons");
// The version in the path lets browsers cache icons for good.
const base = `assets/file-icons/${version}/`;

const MODULE = "virtual:file-icons";

/**
 * Single extensions ("json", not "schema.json"), lower-cased as names are
 * matched ignoring case; the first of equal keys wins.
 */
function extensions(map: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!k.includes(".")) out[k.toLowerCase()] ??= v;
  }
  return out;
}

/** The parts of the theme's manifest the UI needs. */
function theme(): FileIconTheme {
  const m = generateManifest();
  // Icons whose file is named differently from the icon.
  const files: Record<string, string> = {};
  for (const [name, def] of Object.entries(m.iconDefinitions ?? {})) {
    const file = path.basename(def.iconPath, ".svg");
    if (file !== name) files[name] = file;
  }
  return {
    base: `/${base}`,
    file: m.file ?? "file",
    ext: extensions(m.fileExtensions),
    light: extensions(m.light?.fileExtensions),
    files,
  };
}

export function fileIcons(): Plugin {
  return {
    name: "file-icons",
    resolveId: (id) => (id === MODULE ? `\0${MODULE}` : undefined),
    load: (id) => (id === `\0${MODULE}` ? `export default ${JSON.stringify(theme())};` : undefined),
    configureServer(server) {
      server.middlewares.use(`/${base}`, (req, res, next) => {
        const name = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\//, "");
        if (!/^[\w.-]+\.svg$/.test(name)) return next();
        try {
          const svg = readFileSync(path.join(iconsDir, name));
          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.end(svg);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      // Only the icons the mapping uses, e.g. no folder icons.
      const t = theme();
      const used = new Set(
        [t.file, ...Object.values(t.ext), ...Object.values(t.light)].map(
          (icon) => `${t.files[icon] ?? icon}.svg`,
        ),
      );
      for (const name of used) {
        this.emitFile({
          type: "asset",
          fileName: base + name,
          source: readFileSync(path.join(iconsDir, name)),
        });
      }
    },
  };
}
