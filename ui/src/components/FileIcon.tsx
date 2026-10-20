import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { iconUrls } from "../fileIcons.ts";
import { queries } from "../queries.ts";
import { cx } from "./ui.tsx";

/**
 * The icon of a file from Material Icon Theme, e.g. a Go gopher for .go
 * files. Until the icon mapping has loaded, shows fallback.
 */
export function FileIcon({
  name,
  className,
  fallback,
}: {
  name: string;
  className?: string;
  fallback: ReactNode;
}) {
  const { data: theme } = useQuery(queries.fileIcons());
  if (!theme) return fallback;
  const { dark, light } = iconUrls(theme, name);
  const img = (
    <img
      src={light}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cx("size-5 shrink-0", className)}
    />
  );
  // Some icons have a variant drawn for light backgrounds.
  return dark === light ? (
    img
  ) : (
    // One flex item: with display: contents, <source> took part in the
    // layout as an empty item, adding a gap.
    <picture className="flex shrink-0">
      <source srcSet={dark} media="(prefers-color-scheme: dark)" />
      {img}
    </picture>
  );
}
