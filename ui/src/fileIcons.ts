// Picking file icons from Material Icon Theme by file extension; the mapping
// comes from the module "virtual:file-icons" (see vite.file-icons.ts).

export interface FileIconTheme {
  /** URL path the icons are served under, ending in "/". */
  base: string;
  /** Icon of files without a more specific one. */
  file: string;
  /** Icons by lower-case extension, e.g. "json". */
  ext: Record<string, string>;
  /** Icons to use instead on light backgrounds, by extension. */
  light: Record<string, string>;
  /** Icon files not named like their icon. */
  files: Record<string, string>;
}

/** URLs of the icon of a file on dark and on light backgrounds. */
export function iconUrls(theme: FileIconTheme, name: string): { dark: string; light: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const dark = theme.ext[ext] ?? theme.file;
  const light = theme.light[ext] ?? dark;
  const url = (icon: string) => `${theme.base}${theme.files[icon] ?? icon}.svg`;
  return { dark: url(dark), light: url(light) };
}
