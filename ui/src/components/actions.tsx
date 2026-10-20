// Actions on files and folders: the changes (TanStack Query mutations), the
// menu items offering them, and the dialogs asking for their details.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ApiError, api, describeError, joinPath, parentPath, type FileEntry } from "../api.ts";
import { queries } from "../queries.ts";
import { FileViewer } from "./FileViewer.tsx";
import {
  Button,
  buttonClass,
  Confirm,
  DropdownMenu,
  Icon,
  MenuItem,
  MenuSeparator,
  Modal,
  notify,
  notifyError,
  TextField,
} from "./ui.tsx";

export type Action =
  | { kind: "mkdir"; dir: string }
  | { kind: "upload"; dir: string; folder: boolean }
  | { kind: "view" | "rename" | "move" | "delete"; entry: FileEntry };

export type OnAction = (a: Action) => void;

/** Reports a failed change, saying so plainly when permission was missing. */
function failed(err: Error) {
  notifyError(err, err instanceof ApiError && err.status === 403 ? "Permission denied" : undefined);
}

/**
 * The changes to files and folders. Each refreshes every listing and search
 * after it succeeds. When the folder shown (current) or one containing it is
 * moved or deleted, the page follows it, or shows its parent.
 */
export function useFileMutations(current: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["files"] }),
      queryClient.invalidateQueries({ queryKey: ["search"] }),
    ]);

  /**
   * Forgets the listings of path and the folders in it, which are gone, so
   * refreshing does not fetch them again while the tree still shows them.
   */
  const forget = (path: string) =>
    queryClient.removeQueries({
      predicate: ({ queryKey: [kind, p] }) =>
        kind === "files" && typeof p === "string" && (p === path || p.startsWith(`${path}/`)),
    });

  /** Shows where current went after from was moved to `to`, or deleted (null). */
  async function follow(from: string, to: string | null) {
    if (current !== from && !current.startsWith(`${from}/`)) return;
    const next = to === null ? parentPath(from) : to + current.slice(from.length);
    await navigate({ to: "/", search: { path: next === "." ? undefined : next } });
  }

  return {
    mkdir: useMutation({
      mutationFn: api.mkdir,
      onSuccess: refresh,
      onError: failed,
    }),
    move: useMutation({
      mutationFn: ({ from, to }: { from: string; to: string }) => api.move(from, to),
      onSuccess: async (_, { from, to }) => {
        await follow(from, to);
        forget(from);
        await refresh();
      },
      onError: failed,
    }),
    remove: useMutation({
      mutationFn: api.remove,
      onSuccess: async (_, path) => {
        await follow(path, null);
        forget(path);
        await refresh();
      },
      onError: failed,
    }),
  };
}

/**
 * Downloads the file at path. The server sends it as an attachment, so the
 * page stays open; a file that cannot be read gets a notification instead of
 * an error page replacing the app.
 */
async function download(path: string) {
  try {
    await api.checkDownload(path);
    window.location.assign(api.downloadUrl(path));
  } catch (err) {
    notifyError(err, describeError(err, "this file"));
  }
}

/** Menu items for entry, shared by its "⋯" menu and its context menu. */
export function EntryMenuItems({ entry, onAction }: { entry: FileEntry; onAction: OnAction }) {
  const navigate = useNavigate();
  return (
    <>
      {entry.isDir ? (
        <>
          <MenuItem
            icon="folderOpen"
            onClick={() => void navigate({ to: "/", search: { path: entry.path } })}
          >
            Open
          </MenuItem>
          <FolderMenuItems dir={entry.path} onAction={onAction} inside />
        </>
      ) : (
        <>
          <MenuItem icon="eye" onClick={() => onAction({ kind: "view", entry })}>
            View
          </MenuItem>
          <MenuItem icon="download" onClick={() => void download(entry.path)}>
            Download
          </MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem icon="pencil" onClick={() => onAction({ kind: "rename", entry })}>
        Rename…
      </MenuItem>
      <MenuItem icon="move" onClick={() => onAction({ kind: "move", entry })}>
        Move…
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="trash" danger onClick={() => onAction({ kind: "delete", entry })}>
        Delete…
      </MenuItem>
    </>
  );
}

/** Menu items adding to the folder dir; with inside, worded for a folder other than the open one. */
export function FolderMenuItems({
  dir,
  onAction,
  inside = false,
}: {
  dir: string;
  onAction: OnAction;
  inside?: boolean;
}) {
  return (
    <>
      <MenuItem icon="folderPlus" onClick={() => onAction({ kind: "mkdir", dir })}>
        {inside ? "New folder inside…" : "New folder…"}
      </MenuItem>
      <MenuItem icon="upload" onClick={() => onAction({ kind: "upload", dir, folder: false })}>
        {inside ? "Upload files here…" : "Upload files…"}
      </MenuItem>
      <MenuItem icon="folder" onClick={() => onAction({ kind: "upload", dir, folder: true })}>
        {inside ? "Upload a folder here…" : "Upload a folder…"}
      </MenuItem>
    </>
  );
}

/** The "⋯" button of a row. */
export function EntryMenu({ entry, onAction }: { entry: FileEntry; onAction: OnAction }) {
  return (
    <DropdownMenu
      trigger={{
        "aria-label": `Actions for ${entry.name}`,
        className: buttonClass("ghost", "h-8 w-8 px-0 data-popup-open:bg-neutral-200/70"),
        children: <Icon name="more" />,
      }}
    >
      <EntryMenuItems entry={entry} onAction={onAction} />
    </DropdownMenu>
  );
}

/**
 * The dialog of action, if it needs one (not upload): the viewer, or one
 * asking for details. folderName names
 * folders for the user.
 */
export function ActionDialog({
  action,
  current,
  folderName,
  onClose,
}: {
  action: Action | null;
  current: string;
  folderName: (path: string) => string;
  onClose: () => void;
}) {
  const { mkdir, move, remove } = useFileMutations(current);
  const done = (success: string) => ({
    onSuccess: () => {
      notify(success);
      onClose();
    },
  });

  switch (action?.kind) {
    case "view":
      return <FileViewer entry={action.entry} onClose={onClose} />;
    case "mkdir":
      return (
        <NameDialog
          onOpenChange={(o) => !o && onClose()}
          title="New folder"
          description={`In ${folderName(action.dir)}`}
          submitLabel="Create"
          initial=""
          busy={mkdir.isPending}
          onSubmit={(name) =>
            mkdir.mutate(joinPath(action.dir, name), done(`Folder "${name}" created`))
          }
        />
      );
    case "rename":
      return (
        <NameDialog
          onOpenChange={(o) => !o && onClose()}
          title={`Rename ${action.entry.isDir ? "folder" : "file"}`}
          description={action.entry.name}
          submitLabel="Rename"
          initial={action.entry.name}
          busy={move.isPending}
          onSubmit={(name) =>
            move.mutate(
              { from: action.entry.path, to: joinPath(parentPath(action.entry.path), name) },
              done(`Renamed to "${name}"`),
            )
          }
        />
      );
    case "move":
      return (
        <MoveDialog
          entry={action.entry}
          onClose={onClose}
          busy={move.isPending}
          onMove={(target) =>
            move.mutate(
              { from: action.entry.path, to: joinPath(target, action.entry.name) },
              done(`Moved "${action.entry.name}" to ${folderName(target)}`),
            )
          }
        />
      );
    case "delete": {
      const { entry } = action;
      return (
        <Confirm
          open
          onOpenChange={(o) => !o && onClose()}
          title={`Delete ${entry.isDir ? "folder" : "file"}?`}
          description={
            entry.isDir
              ? `"${entry.name}" and everything in it will be deleted permanently.`
              : `"${entry.name}" will be deleted permanently.`
          }
          confirmLabel="Delete"
          onConfirm={() => remove.mutate(entry.path, done(`Deleted "${entry.name}"`))}
        />
      );
    }
    default:
      return null;
  }
}

/** A dialog asking for a file or folder name; mount it only while open. */
function NameDialog({
  onOpenChange,
  title,
  description,
  submitLabel,
  initial,
  busy,
  onSubmit,
}: {
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initial: string;
  busy: boolean;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const showHidden = useQuery(queries.settings()).data?.showHidden ?? false;

  const trimmed = name.trim();
  const invalid =
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    (!showHidden && trimmed.startsWith("."));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !trimmed || invalid || trimmed === initial) return;
    onSubmit(trimmed);
  }

  return (
    <Modal open onOpenChange={onOpenChange} title={title} description={description}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Name"
          invalid={invalid}
          error={
            showHidden
              ? "Names cannot contain slashes."
              : "Names cannot contain slashes or start with a dot (hidden files are off in Settings)."
          }
          value={name}
          onValueChange={setName}
          onFocus={(e) => {
            // Select the name without its extension, like file managers do.
            const dot = e.currentTarget.value.lastIndexOf(".");
            e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
          }}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !trimmed || invalid || trimmed === initial}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Lets the user pick a target folder by browsing the root folder. */
function MoveDialog({
  entry,
  busy,
  onClose,
  onMove,
}: {
  entry: FileEntry;
  busy: boolean;
  onClose: () => void;
  onMove: (targetDir: string) => void;
}) {
  const current = parentPath(entry.path);
  const rootName = useQuery(queries.info()).data?.name ?? "Root";
  const [dir, setDir] = useState(current);
  const { data: folders, error } = useQuery({
    ...queries.files(dir),
    select: (l) => l.entries.filter((e) => e.isDir && e.path !== entry.path),
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Move "${entry.name}"`}
      description="Choose the folder to move it to."
    >
      <div className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950">
          <Button
            variant="ghost"
            className="h-7 px-2"
            disabled={dir === "."}
            onClick={() => setDir(parentPath(dir))}
            aria-label="Up one folder"
          >
            ↑
          </Button>
          <span className="truncate font-medium">
            {dir === "." ? rootName : `${rootName}/${dir}`}
          </span>
        </div>
        <ul className="h-56 overflow-y-auto p-1">
          {error ? (
            <li className="px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {describeError(error, "this folder")}
            </li>
          ) : !folders ? (
            <li className="px-3 py-2 text-sm text-neutral-500">Loading…</li>
          ) : folders.length === 0 ? (
            <li className="px-3 py-2 text-sm text-neutral-500">No sub-folders</li>
          ) : (
            folders.map((f) => (
              <li key={f.path}>
                <Button
                  variant="plain"
                  className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  onClick={() => setDir(f.path)}
                >
                  <Icon name="folder" className="text-amber-500" />
                  <span className="truncate">{f.name}</span>
                </Button>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || dir === current} onClick={() => onMove(dir)}>
          Move here
        </Button>
      </div>
    </Modal>
  );
}
