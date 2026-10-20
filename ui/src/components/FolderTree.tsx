import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ApiError, describeError, type FileEntry } from "../api.ts";
import type { DragDrop } from "../dnd.ts";
import { queries } from "../queries.ts";
import { useContextEntry } from "./FileContextMenu.tsx";
import { Button, cx, Icon } from "./ui.tsx";

/** How long a drag has to hover over a collapsed folder to open it. */
const SPRING_OPEN_MS = 700;

/** The folders containing path, and path itself: "a/b" gives ".", "a", "a/b". */
function lineage(path: string): string[] {
  if (path === ".") return ["."];
  const parts = path.split("/");
  return [".", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
}

interface TreeState {
  current: string;
  expanded: Set<string>;
  setOpen: (path: string, open: boolean) => void;
  /** Opens path and expands it if collapsed, or collapses it if expanded. */
  clicked: (path: string, open: boolean) => void;
  dnd: DragDrop;
  onNavigate?: () => void;
}

/** The folders of the root as a tree, opened down to the current folder. */
export function FolderTree({
  current,
  rootName,
  dnd,
  onNavigate,
}: {
  current: string;
  rootName: string;
  dnd: DragDrop;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(() => new Set(lineage(current)));
  // The folder last clicked in the tree, which decides itself whether it is
  // expanded.
  const [clicked, setClicked] = useState<string | null>(null);
  // Open the tree down to the current folder whenever it changes, keeping
  // what the user opened.
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    const open = lineage(current);
    if (clicked === current) open.pop();
    setExpanded((s) => new Set([...s, ...open]));
  }

  const setOpen = (path: string, open: boolean) =>
    setExpanded((s) => {
      if (s.has(path) === open) return s;
      const next = new Set(s);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });

  const tree: TreeState = {
    current,
    expanded,
    dnd,
    onNavigate,
    setOpen,
    clicked: (path, open) => {
      setClicked(path);
      setOpen(path, !open);
      onNavigate?.();
    },
  };

  return (
    <nav aria-label="Folders" className="p-2">
      <ul className="text-sm">
        <TreeItem path="." name={rootName} depth={0} tree={tree} />
      </ul>
    </nav>
  );
}

function TreeItem({
  path,
  name,
  entry,
  depth,
  tree,
}: {
  path: string;
  name: string;
  /** The folder's entry, for dragging; none for the root. */
  entry?: FileEntry;
  depth: number;
  tree: TreeState;
}) {
  const open = tree.expanded.has(path);
  const selected = tree.current === path;
  const { data: folders, error } = useQuery({
    ...queries.files(path),
    enabled: open,
    select: (l) => l.entries.filter((e) => e.isDir),
  });
  const leaf = open && folders?.length === 0;

  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Hovering a drag over a collapsed folder opens it, to drop deeper.
  const springTimer = useRef<number | undefined>(undefined);
  const stopSpring = () => {
    window.clearTimeout(springTimer.current);
    springTimer.current = undefined;
  };
  useEffect(() => () => window.clearTimeout(springTimer.current), []);
  const zone = tree.dnd.dropZone(path);
  const context = useContextEntry(entry);

  return (
    <li>
      <div
        ref={row}
        {...(entry && tree.dnd.draggable(entry))}
        {...context.props}
        onDragOver={(e) => {
          zone.onDragOver(e);
          if (!open && springTimer.current === undefined) {
            springTimer.current = window.setTimeout(() => {
              springTimer.current = undefined;
              tree.setOpen(path, true);
            }, SPRING_OPEN_MS);
          }
        }}
        onDragLeave={(e) => {
          zone.onDragLeave(e);
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) stopSpring();
        }}
        onDrop={(e) => {
          stopSpring();
          zone.onDrop(e);
        }}
        style={{ paddingLeft: `${depth * 0.875}rem` }}
        className={cx(
          "flex h-8 items-center gap-0.5 rounded-md pr-2",
          selected
            ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100"
            : context.menuOpen
              ? "bg-neutral-200/80 dark:bg-neutral-800"
              : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/70",
          tree.dnd.dropTarget === path && "outline-2 -outline-offset-2 outline-indigo-500",
        )}
      >
        {leaf ? (
          <span className="size-6 shrink-0" />
        ) : (
          <Button
            variant="plain"
            tabIndex={-1}
            aria-expanded={open}
            aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
            onClick={() => tree.setOpen(path, !open)}
            className="grid size-6 shrink-0 place-items-center rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <Icon
              name="chevron"
              className={cx("size-3.5 transition-transform", open && "rotate-90")}
            />
          </Button>
        )}
        <Link
          to="/"
          search={{ path: path === "." ? undefined : path }}
          onClick={(e) => {
            // Leave modified clicks, e.g. to open a new tab, to the browser.
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            tree.clicked(path, open);
          }}
          aria-current={selected ? "page" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 outline-offset-2"
          title={name}
        >
          <Icon
            name={depth === 0 ? "home" : "folder"}
            className={cx("size-4", depth === 0 ? "text-indigo-500" : "text-amber-500")}
          />
          <span className={cx("truncate", selected && "font-medium")}>{name}</span>
        </Link>
      </div>
      {open && !leaf && (
        <ul>
          {error ? (
            <li
              className="truncate py-1 text-xs text-red-600 dark:text-red-400"
              style={{ paddingLeft: `${(depth + 1) * 0.875 + 1.625}rem` }}
            >
              {
                // The full sentence does not fit the tree.
                error instanceof ApiError && error.status === 403
                  ? "No permission"
                  : describeError(error, "this folder")
              }
            </li>
          ) : !folders ? (
            <li
              className="py-1 text-xs text-neutral-500"
              style={{ paddingLeft: `${(depth + 1) * 0.875 + 1.625}rem` }}
            >
              Loading…
            </li>
          ) : (
            folders.map((f) => (
              <TreeItem
                key={f.path}
                path={f.path}
                name={f.name}
                entry={f}
                depth={depth + 1}
                tree={tree}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}
