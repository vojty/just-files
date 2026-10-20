import { Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { formatSize, parentPath, type FileEntry, type FileKind } from "../api.ts";
import type { DragDrop } from "../dnd.ts";
import { COLUMNS, useView, type ColumnId, type Sort, type SortKey } from "../view.ts";
import { EntryMenu, type OnAction } from "./actions.tsx";
import { useContextEntry } from "./FileContextMenu.tsx";
import { FileIcon } from "./FileIcon.tsx";
import { Button, buttonClass, cx, DropdownMenu, Icon, MenuCheckboxItem, MenuGroup } from "./ui.tsx";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const kindIcon: Record<
  FileKind,
  "folder" | "image" | "video" | "audio" | "text" | "archive" | "file"
> = {
  folder: "folder",
  image: "image",
  video: "video",
  audio: "audio",
  text: "text",
  archive: "archive",
  other: "file",
};

const kindColor: Record<FileKind, string> = {
  folder: "text-amber-500",
  image: "text-sky-500",
  video: "text-indigo-500",
  audio: "text-pink-500",
  text: "text-emerald-500",
  archive: "text-orange-700 dark:text-orange-400",
  other: "text-neutral-400",
};

/** A description of the type, e.g. "JPG image", "Folder". */
export function typeLabel(e: FileEntry): string {
  const kind = e.kind === "other" ? "file" : e.kind;
  const dot = e.name.lastIndexOf(".");
  if (e.isDir || dot <= 0) return kind[0].toUpperCase() + kind.slice(1);
  return `${e.name.slice(dot + 1).toUpperCase()} ${kind}`;
}

type ColumnKey = ColumnId | "folder";

interface Column {
  label: string;
  /** Sorts descending on the first click, e.g. newest or biggest first. */
  descFirst?: boolean;
  compare: (a: FileEntry, b: FileEntry) => number;
  cell: (e: FileEntry, rootName: string) => ReactNode;
  className?: string;
}

const byName = (a: FileEntry, b: FileEntry) => collator.compare(a.name, b.name);

const columns: Record<ColumnKey, Column> = {
  folder: {
    label: "Folder",
    compare: (a, b) => collator.compare(parentPath(a.path), parentPath(b.path)),
    cell: (e, rootName) => <FolderLink path={parentPath(e.path)} rootName={rootName} />,
    className: "max-w-0 min-w-40 w-1/3",
  },
  type: {
    label: "Type",
    compare: (a, b) => collator.compare(typeLabel(a), typeLabel(b)),
    cell: typeLabel,
  },
  size: {
    label: "Size",
    descFirst: true,
    // Folder sizes are those of the folder entry itself, not of its content.
    compare: (a, b) => (a.isDir || b.isDir ? 0 : a.size - b.size),
    cell: (e) => (e.isDir ? "—" : formatSize(e.size)),
    className: "text-right tabular-nums",
  },
  modified: {
    label: "Modified",
    descFirst: true,
    compare: (a, b) => Date.parse(a.modTime) - Date.parse(b.modTime),
    cell: (e) => dateFormat.format(new Date(e.modTime)),
    className: "tabular-nums",
  },
  permissions: {
    label: "Permissions",
    compare: (a, b) => a.mode.localeCompare(b.mode),
    cell: (e) => <span className="font-mono text-xs">{e.mode}</span>,
  },
  owner: {
    label: "Owner",
    compare: (a, b) => collator.compare(a.owner, b.owner),
    cell: (e) => e.owner,
  },
  group: {
    label: "Group",
    compare: (a, b) => collator.compare(a.group, b.group),
    cell: (e) => e.group,
  },
};

/** Sorts entries, folders first; ties are broken by name. */
export function sortEntries(entries: FileEntry[], sort: Sort | null): FileEntry[] {
  if (!sort) return entries;
  const compare = sort.by === "name" ? byName : columns[sort.by].compare;
  const dir = sort.desc ? -1 : 1;
  return entries.toSorted(
    (a, b) => Number(b.isDir) - Number(a.isDir) || dir * compare(a, b) || byName(a, b),
  );
}

/**
 * Files and folders as a table with the columns chosen by the user. With
 * showFolder (search results), a column links each entry's folder, and sort
 * may be null to keep the given order.
 */
export function FileTable({
  entries,
  dnd,
  onAction,
  rootName,
  sort,
  onSort,
  showFolder = false,
}: {
  entries: FileEntry[];
  dnd: DragDrop;
  onAction: OnAction;
  rootName: string;
  sort: Sort | null;
  onSort: (sort: Sort | null) => void;
  showFolder?: boolean;
}) {
  const { columns: visible } = useView();
  const shown: ColumnKey[] = showFolder ? ["folder", ...visible] : visible;
  const rows = useMemo(() => sortEntries(entries, sort), [entries, sort]);

  /**
   * Sorts by key, reversing on a repeated click. In search results, a third
   * click goes back to the order of relevance.
   */
  function sortBy(key: SortKey) {
    const descFirst = key !== "name" && Boolean(columns[key].descFirst);
    if (sort?.by !== key) onSort({ by: key, desc: descFirst });
    else if (showFolder && sort.desc !== descFirst) onSort(null);
    else onSort({ by: key, desc: !sort.desc });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
          <tr>
            <SortHeader label="Name" sortKey="name" sort={sort} onSort={sortBy} />
            {shown.map((id) => (
              <SortHeader
                key={id}
                label={columns[id].label}
                sortKey={id}
                sort={sort}
                onSort={sortBy}
                alignRight={id === "size"}
              />
            ))}
            <th className="w-12 px-2 text-right">
              <ColumnsMenu />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {rows.map((entry) => (
            <Row
              key={entry.path}
              entry={entry}
              columns={shown}
              dnd={dnd}
              onAction={onAction}
              rootName={rootName}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  alignRight = false,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
  alignRight?: boolean;
}) {
  const active = sort?.by === sortKey;
  return (
    <th
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
      className={cx("px-2 py-1 font-medium whitespace-nowrap", alignRight && "text-right")}
    >
      <Button
        variant="plain"
        onClick={() => onSort(sortKey)}
        className={cx(
          "inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
          alignRight && "flex-row-reverse",
          active && "text-neutral-900 dark:text-neutral-100",
        )}
      >
        {label}
        <Icon
          name="arrowUp"
          className={cx(
            "size-3 transition-transform",
            !active && "invisible",
            active && sort.desc && "rotate-180",
          )}
        />
      </Button>
    </th>
  );
}

/** Picks the visible columns. */
function ColumnsMenu() {
  const view = useView();
  return (
    <DropdownMenu
      trigger={{
        "aria-label": "Choose columns",
        className: buttonClass("ghost", "h-7 w-8 px-0 data-popup-open:bg-neutral-200/70"),
        children: <Icon name="columns" />,
      }}
    >
      <MenuGroup label="Columns">
        {COLUMNS.map((id) => (
          <MenuCheckboxItem
            key={id}
            checked={view.columns.includes(id)}
            onCheckedChange={(show) => view.toggleColumn(id, show)}
          >
            {columns[id].label}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
    </DropdownMenu>
  );
}

function Row({
  entry,
  columns: shown,
  dnd,
  onAction,
  rootName,
}: {
  entry: FileEntry;
  columns: ColumnKey[];
  dnd: DragDrop;
  onAction: OnAction;
  rootName: string;
}) {
  const context = useContextEntry(entry);
  return (
    <tr
      {...dnd.draggable(entry)}
      {...(entry.isDir && dnd.dropZone(entry.path))}
      {...context.props}
      className={cx(
        "hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
        context.menuOpen && "bg-neutral-100 dark:bg-neutral-800",
        dnd.dropTarget === entry.path &&
          "bg-indigo-50 outline-2 -outline-offset-2 outline-indigo-500 dark:bg-indigo-950/60",
      )}
    >
      <td className="max-w-0 min-w-48 px-4 py-2">
        <EntryName entry={entry} onAction={onAction} />
      </td>
      {shown.map((id) => (
        <td
          key={id}
          className={cx("px-4 py-2 whitespace-nowrap text-neutral-500", columns[id].className)}
        >
          {columns[id].cell(entry, rootName)}
        </td>
      ))}
      <td className="px-2 py-1 text-right">
        <EntryMenu entry={entry} onAction={onAction} />
      </td>
    </tr>
  );
}

function EntryName({ entry, onAction }: { entry: FileEntry; onAction: OnAction }) {
  const content = (
    <>
      {entry.isDir ? (
        <Icon name="folder" className="size-5 text-amber-500" />
      ) : (
        <FileIcon
          name={entry.name}
          fallback={
            <Icon name={kindIcon[entry.kind]} className={cx("size-5", kindColor[entry.kind])} />
          }
        />
      )}
      <span className="truncate">{entry.name}</span>
    </>
  );
  return entry.isDir ? (
    <Link
      to="/"
      search={{ path: entry.path }}
      className="flex items-center gap-2.5 font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
    >
      {content}
    </Link>
  ) : (
    <Button
      variant="plain"
      className="flex max-w-full items-center gap-2.5 rounded text-left hover:text-indigo-600 dark:hover:text-indigo-400"
      title={entry.name}
      onClick={() => onAction({ kind: "view", entry })}
    >
      {content}
    </Button>
  );
}

function FolderLink({ path, rootName }: { path: string; rootName: string }) {
  return (
    <Link
      to="/"
      search={{ path: path === "." ? undefined : path }}
      className="block truncate hover:text-indigo-600 dark:hover:text-indigo-400"
      title={path === "." ? rootName : path}
    >
      {path === "." ? rootName : path}
    </Link>
  );
}
