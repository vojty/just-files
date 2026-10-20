import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { errorText, joinPath, type SearchResults } from "../api.ts";
import {
  ActionDialog,
  useFileMutations,
  type Action,
  type OnAction,
} from "../components/actions.tsx";
import { FileContextMenu } from "../components/FileContextMenu.tsx";
import { FileTable } from "../components/FileTable.tsx";
import { FolderTree } from "../components/FolderTree.tsx";
import {
  Button,
  buttonClass,
  cx,
  DropdownMenu,
  Icon,
  MenuItem,
  notify,
  TextInput,
} from "../components/ui.tsx";
import { useDragDrop, type DragDrop } from "../dnd.ts";
import { fromFiles, type UploadItem } from "../dropped.ts";
import { queries } from "../queries.ts";
import { useView, type Sort } from "../view.ts";
import { enqueue } from "../uploads.ts";

interface BrowserSearch {
  path?: string;
  q?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): BrowserSearch => ({
    path: typeof search.path === "string" && search.path !== "." ? search.path : undefined,
    q: typeof search.q === "string" && search.q.trim() !== "" ? search.q : undefined,
  }),
  // Typing a search must not reload the folder.
  loaderDeps: ({ search }) => ({ path: search.path ?? "." }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(queries.files(deps.path)),
      context.queryClient.ensureQueryData(queries.info()),
    ]),
  component: Browser,
  errorComponent: ({ error }) => (
    <div className="flex flex-col items-start gap-3 p-6">
      <p className="text-sm text-red-600 dark:text-red-400">{errorText(error)}</p>
      <Link to="/" className={buttonClass("secondary")}>
        Back to the root folder
      </Link>
    </div>
  ),
});

function Browser() {
  const { path } = Route.useLoaderDeps();
  const { q } = Route.useSearch();
  const { data: listing } = useSuspenseQuery(queries.files(path));
  const { data: info } = useSuspenseQuery(queries.info());
  const queryClient = useQueryClient();
  const dir = listing.path;
  const [action, setAction] = useState<Action | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const { move } = useFileMutations(dir);
  const view = useView();

  const folderName = (p: string) => (p === "." ? info.name : p);

  /** Queues files for upload below target, creating the folders of folder uploads. */
  function upload(target: string, items: UploadItem[]) {
    const byDir = new Map<string, File[]>();
    for (const { file, dir: sub } of items) {
      const group = byDir.get(sub);
      if (group) group.push(file);
      else byDir.set(sub, [file]);
    }
    const existing = new Set(
      queryClient.getQueryData(queries.files(target).queryKey)?.entries.map((e) => e.name),
    );
    for (const [sub, files] of byDir) {
      if (sub === "") enqueue(target, files, existing);
      else enqueue(joinPath(target, sub), files, undefined, true);
    }
  }

  const picker = useUploadPicker(upload);

  /** Runs action: uploads open the file picker, the rest a dialog. */
  const act: OnAction = (a) => {
    if (a.kind === "upload") picker.open(a.dir, a.folder);
    else setAction(a);
  };

  const dnd = useDragDrop({
    onUpload: upload,
    onMove: (entry, target) =>
      move.mutate(
        { from: entry.path, to: joinPath(target, entry.name) },
        { onSuccess: () => notify(`Moved "${entry.name}" to ${folderName(target)}`) },
      ),
  });

  return (
    <div className="flex h-dvh flex-col" {...dnd.area(dir)}>
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950">
        <Button
          variant="ghost"
          className="w-9 px-0 md:hidden"
          aria-label={treeOpen ? "Hide folders" : "Show folders"}
          aria-expanded={treeOpen}
          onClick={() => setTreeOpen((o) => !o)}
        >
          <Icon name="sidebar" />
        </Button>
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-md bg-indigo-600 text-white">
            <Icon name="search" className="size-3.5" />
          </span>
          <span className="hidden sm:inline">just-files</span>
        </Link>
        <SearchBox q={q ?? ""} scopeName={folderName(dir)} />
      </header>

      <div className="relative flex min-h-0 flex-1">
        <TreePanel open={treeOpen} onClose={() => setTreeOpen(false)}>
          <FileContextMenu folder="." onAction={act} className="min-h-full">
            <FolderTree
              current={dir}
              rootName={info.name}
              dnd={dnd}
              onNavigate={() => setTreeOpen(false)}
            />
          </FileContextMenu>
        </TreePanel>

        <section aria-label="Current folder" className="relative flex min-w-0 flex-1 flex-col">
          <FileContextMenu
            folder={dir}
            onAction={act}
            className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pb-32"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Breadcrumbs path={dir} rootName={info.name} dnd={dnd} />
              <div className="ml-auto flex gap-2">
                <Button onClick={() => act({ kind: "mkdir", dir })}>
                  <Icon name="folderPlus" />
                  New folder
                </Button>
                <UploadButton dir={dir} onAction={act} />
              </div>
            </div>

            {/* shrink-0: with overflow hidden, the card could otherwise shrink to
                the panel's height and clip the rows instead of the panel scrolling. */}
            <div className="shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              {q ? (
                <SearchPanel
                  path={dir}
                  q={q}
                  dnd={dnd}
                  onAction={act}
                  rootName={info.name}
                  scopeName={folderName(dir)}
                />
              ) : listing.entries.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-16 text-center text-sm text-neutral-500">
                  <Icon name="upload" className="size-8 text-neutral-300 dark:text-neutral-600" />
                  This folder is empty. Drop files or folders here, or use Upload.
                  <span className="text-xs">Right-click for more.</span>
                </div>
              ) : (
                <FileTable
                  entries={listing.entries}
                  dnd={dnd}
                  onAction={act}
                  rootName={info.name}
                  sort={view.sort}
                  onSort={(s) => s && view.setSort(s)}
                />
              )}
            </div>
          </FileContextMenu>

          {dnd.draggingFiles && dnd.dropTarget === null && (
            <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-50/80 text-sm font-medium text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
              Drop files or folders to upload to {folderName(dir)}
            </div>
          )}
        </section>
      </div>

      <ActionDialog
        action={action}
        current={dir}
        folderName={folderName}
        onClose={() => setAction(null)}
      />
      {picker.inputs}
    </div>
  );
}

const TREE_WIDTH_KEY = "just-files.treeWidth";
const TREE_WIDTH = { min: 180, max: 560, initial: 280 };

function storedTreeWidth(): number {
  try {
    const n = Number(localStorage.getItem(TREE_WIDTH_KEY));
    if (n >= TREE_WIDTH.min && n <= TREE_WIDTH.max) return n;
  } catch {
    // Storage may be unavailable, e.g. in private windows.
  }
  return TREE_WIDTH.initial;
}

/**
 * The left panel: resizable beside the folder on wide screens, a drawer over
 * it on narrow ones.
 */
function TreePanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(storedTreeWidth);
  const panel = useRef<HTMLElement>(null);

  function resize(w: number) {
    const clamped = Math.round(Math.min(TREE_WIDTH.max, Math.max(TREE_WIDTH.min, w)));
    setWidth(clamped);
    try {
      localStorage.setItem(TREE_WIDTH_KEY, String(clamped));
    } catch {
      // Not remembered then.
    }
  }

  return (
    <>
      {open && (
        <Button
          variant="plain"
          aria-label="Hide folders"
          className="absolute inset-0 z-20 bg-black/30 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        ref={panel}
        aria-label="Folder tree"
        style={{ "--tree-width": `${width}px` } as CSSProperties}
        className={cx(
          "shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-100/60 dark:border-neutral-800 dark:bg-neutral-900/60",
          "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-72 max-md:max-w-[85vw] max-md:bg-neutral-50 max-md:shadow-xl max-md:dark:bg-neutral-900",
          "md:w-(--tree-width)",
          !open && "max-md:hidden",
        )}
      >
        {children}
      </aside>
      <div
        // A focusable splitter, which <hr> cannot be.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize folder tree"
        aria-valuemin={TREE_WIDTH.min}
        aria-valuemax={TREE_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        className="relative z-10 -ml-1 hidden w-2 shrink-0 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 hover:after:bg-indigo-500 focus-visible:after:bg-indigo-500 md:block"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const left = panel.current?.getBoundingClientRect().left ?? 0;
          resize(e.clientX - left);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") resize(width - 16);
          else if (e.key === "ArrowRight") resize(width + 16);
        }}
      />
    </>
  );
}

/** The search field; searches below the current folder as you type. */
function SearchBox({ q, scopeName }: { q: string; scopeName: string }) {
  const navigate = useNavigate({ from: "/" });
  const [value, setValue] = useState(q);
  const input = useRef<HTMLInputElement>(null);

  // Follow the URL, e.g. after navigating back.
  const [shown, setShown] = useState(q);
  if (shown !== q) {
    setShown(q);
    setValue(q);
  }

  // Update the URL shortly after typing stops.
  useEffect(() => {
    if (value.trim() === q.trim()) return;
    const t = window.setTimeout(
      () =>
        void navigate({
          search: (s) => ({ ...s, q: value.trim() || undefined }),
          replace: true,
        }),
      200,
    );
    return () => window.clearTimeout(t);
  }, [value, q, navigate]);

  // "/" or Ctrl+K focuses the search, as on many sites.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "/" && !typing) || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative ml-auto w-full max-w-md">
      <Icon
        name="search"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400"
      />
      <TextInput
        ref={input}
        type="search"
        aria-label="Search"
        placeholder={`Search in ${scopeName}`}
        className="pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
        value={value}
        onValueChange={setValue}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            void navigate({ search: (s) => ({ ...s, q: undefined }), replace: true });
          }
        }}
      />
      {value ? (
        <Button
          variant="plain"
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          onClick={() => {
            setValue("");
            void navigate({ search: (s) => ({ ...s, q: undefined }), replace: true });
            input.current?.focus();
          }}
        >
          <Icon name="close" />
        </Button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-neutral-300 px-1.5 text-xs text-neutral-400 sm:block dark:border-neutral-700">
          /
        </kbd>
      )}
    </div>
  );
}

/** Whether the index has not been filled yet: Go's zero time is year 1. */
const notIndexed = (r: SearchResults | undefined) =>
  r !== undefined && new Date(r.scannedAt).getUTCFullYear() < 2;

function SearchPanel({
  path,
  q,
  dnd,
  onAction,
  rootName,
  scopeName,
}: {
  path: string;
  q: string;
  dnd: DragDrop;
  onAction: OnAction;
  rootName: string;
  scopeName: string;
}) {
  // Results come by relevance until a column is chosen.
  const [sort, setSort] = useState<Sort | null>(null);
  const { data, error, isPlaceholderData } = useQuery({
    ...queries.search(path, q),
    placeholderData: keepPreviousData,
    // Poll until the first scan of the folder is done.
    refetchInterval: (query) => (notIndexed(query.state.data) ? 1000 : false),
  });

  if (error) return <Status error>{errorText(error)}</Status>;
  if (!data) return <Status>Searching…</Status>;
  if (notIndexed(data)) {
    return <Status>Indexing the folder, results will show in a moment…</Status>;
  }

  return (
    <div className={cx(isPlaceholderData && "opacity-60 transition-opacity")}>
      <p className="border-b border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">
        {data.total === 0
          ? "No matches"
          : `${data.total.toLocaleString()} match${data.total === 1 ? "" : "es"}`}{" "}
        for “{q}” in {scopeName}
        {data.entries.length < data.total && `, showing the first ${data.entries.length}`}
        {data.scanning && " · updating the index…"}
      </p>
      {data.entries.length > 0 && (
        <FileTable
          entries={data.entries}
          dnd={dnd}
          onAction={onAction}
          showFolder
          rootName={rootName}
          sort={sort}
          onSort={setSort}
        />
      )}
    </div>
  );
}

function Status({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        "px-4 py-16 text-center text-sm",
        error ? "text-red-600 dark:text-red-400" : "text-neutral-500",
      )}
    >
      {children}
    </div>
  );
}

function UploadButton({ dir, onAction }: { dir: string; onAction: OnAction }) {
  return (
    <DropdownMenu
      trigger={{
        className: buttonClass("primary"),
        children: (
          <>
            <Icon name="upload" />
            Upload
          </>
        ),
      }}
    >
      <MenuItem icon="file" onClick={() => onAction({ kind: "upload", dir, folder: false })}>
        Files…
      </MenuItem>
      <MenuItem icon="folder" onClick={() => onAction({ kind: "upload", dir, folder: true })}>
        Folder…
      </MenuItem>
    </DropdownMenu>
  );
}

/**
 * Hidden file inputs for picking files or a whole folder to upload into a
 * folder; render inputs and call open from a click.
 */
function useUploadPicker(onFiles: (dir: string, items: UploadItem[]) => void) {
  const target = useRef(".");
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.currentTarget.files;
    if (list && list.length > 0) onFiles(target.current, fromFiles(Array.from(list)));
    e.currentTarget.value = "";
  };

  return {
    open: (dir: string, pickFolder: boolean) => {
      target.current = dir;
      (pickFolder ? folder : files).current?.click();
    },
    inputs: (
      <>
        <input ref={files} type="file" multiple hidden onChange={onChange} />
        <input
          ref={(el) => {
            folder.current = el;
            // Not in React's input attributes.
            if (el) el.webkitdirectory = true;
          }}
          type="file"
          hidden
          onChange={onChange}
        />
      </>
    ),
  };
}

/** The path of the current folder; each part is a link and a drop target. */
function Breadcrumbs({ path, rootName, dnd }: { path: string; rootName: string; dnd: DragDrop }) {
  const parts = path === "." ? [] : path.split("/");
  const dropHighlight = "bg-indigo-100 outline-2 outline-indigo-500 dark:bg-indigo-950";
  return (
    <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <Link
        to="/"
        {...dnd.dropZone(".")}
        className={cx(
          "flex items-center gap-1.5 rounded px-1.5 py-1 font-medium hover:bg-neutral-200/70 dark:hover:bg-neutral-800",
          dnd.dropTarget === "." && dropHighlight,
        )}
      >
        <Icon name="home" />
        {rootName}
      </Link>
      {parts.map((part, i) => {
        const to = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span key={to} className="flex min-w-0 items-center gap-1">
            <Icon name="chevron" className="text-neutral-400" />
            {last ? (
              <span className="truncate px-1.5 py-1 font-medium" aria-current="page">
                {part}
              </span>
            ) : (
              <Link
                to="/"
                search={{ path: to }}
                {...dnd.dropZone(to)}
                className={cx(
                  "truncate rounded px-1.5 py-1 hover:bg-neutral-200/70 dark:hover:bg-neutral-800",
                  dnd.dropTarget === to && dropHighlight,
                )}
              >
                {part}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
