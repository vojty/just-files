// Edits a text file in a dialog laid out like the viewer's, with CodeMirror.
// Saving checks that the file has not changed since it was opened, and
// closing with unsaved changes asks first.
import { Dialog } from "@base-ui/react/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, api, describeError, formatSize, type FileEntry } from "../api.ts";
import { EDIT_LIMIT, queries } from "../queries.ts";
import type { EditorHandle } from "./CodeEditor.tsx";
import { FileIcon } from "./FileIcon.tsx";
import { typeLabel } from "./FileTable.tsx";
import { backdropClass, Button, Confirm, Icon, notify, notifyError, Tip } from "./ui.tsx";

/**
 * Whether to offer editing entry: text files the editor can open. Viewers
 * may also offer it for other files that turn out to be text.
 */
export function canEdit(entry: FileEntry) {
  return entry.kind === "text" && entry.size <= EDIT_LIMIT;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const CodeEditor = lazy(() => import("./CodeEditor.tsx"));

export function FileEditor({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [wrap, setWrap] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /** Text the server refused to save as the file had changed since. */
  const [conflict, setConflict] = useState<string | null>(null);
  /** The file as last read or saved. */
  const [file, setFile] = useState(entry);
  const tooLarge = entry.size > EDIT_LIMIT;
  const { data, error } = useQuery({
    ...queries.editableText(entry.path, entry.modTime),
    enabled: !tooLarge,
  });
  /** The text last saved; until then, the file as read. */
  const [lastSaved, setSaved] = useState<string | null>(null);
  const saved = lastSaved ?? data?.text ?? null;
  const editor = useRef<EditorHandle>(null);
  const popup = useRef<HTMLDivElement>(null);

  // Closing the tab or reloading would lose the changes too.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: ({ text, overwrite }: { text: string; overwrite: boolean }) =>
      api.saveText(file.path, text, overwrite ? undefined : file.modTime),
    onSuccess: async (updated, { text }) => {
      setFile(updated);
      setSaved(text);
      notify(`Saved "${updated.name}"`);
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (err, { text }) => {
      if (err instanceof ApiError && err.status === 409) setConflict(text);
      else {
        notifyError(
          err,
          err instanceof ApiError && err.status === 403 ? "Permission denied" : "Not saved",
        );
      }
    },
  });

  function trySave(overwrite = false) {
    const text = editor.current?.text();
    if (text === undefined || save.isPending) return;
    save.mutate({ text, overwrite });
  }

  function close() {
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  let body: ReactNode;
  if (tooLarge) {
    body = (
      <Message>
        This file is too large to edit here ({formatSize(entry.size)}, at most{" "}
        {formatSize(EDIT_LIMIT)}).
      </Message>
    );
  } else if (error) {
    body = <Message>{describeError(error, "this file")}</Message>;
  } else if (data && data.text === null) {
    body = (
      <Message>
        {data.reason === "binary"
          ? "This is not a text file."
          : "This file is not UTF-8 text; saving it would garble its characters."}
      </Message>
    );
  } else if (typeof data?.text === "string" && saved !== null) {
    body = (
      <Suspense fallback={<Message>Loading editor…</Message>}>
        <CodeEditor
          name={entry.name}
          initial={data.text}
          saved={saved}
          wrap={wrap}
          handle={editor}
          onDirtyChange={setDirty}
          onSave={() => trySave()}
        />
      </Suspense>
    );
  } else {
    body = <Message>Loading…</Message>;
  }

  const ready = typeof data?.text === "string" && saved !== null;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          ref={popup}
          // Not the first button, which would show its tooltip; the editor
          // takes the focus once loaded.
          initialFocus={popup}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:inset-6 dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-neutral-200 py-2 pr-2 pl-4 dark:border-neutral-800">
            <FileIcon name={entry.name} className="size-6" fallback={null} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Dialog.Title className="truncate text-sm font-semibold" title={entry.name}>
                {dirty && <span aria-label="Unsaved changes">● </span>}
                {entry.name}
              </Dialog.Title>
              <Dialog.Description className="truncate text-xs text-neutral-500">
                Editing · {typeLabel(file)} · {formatSize(file.size)}
              </Dialog.Description>
            </div>
            <Tip label="Wrap long lines">
              <Button
                variant="ghost"
                className="h-8 w-8 px-0"
                aria-label="Wrap long lines"
                aria-pressed={wrap}
                onClick={() => setWrap((w) => !w)}
              >
                <Icon
                  name="wrap"
                  className={wrap ? "text-indigo-600 dark:text-indigo-400" : undefined}
                />
              </Button>
            </Tip>
            <Tip label={isMac ? "⌘S" : "Ctrl+S"}>
              <Button
                variant="primary"
                className="h-8"
                disabled={!ready || !dirty || save.isPending}
                onClick={() => trySave()}
              >
                <Icon name="check" />
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </Tip>
            <Tip label="Close">
              <Button variant="ghost" className="h-8 w-8 px-0" aria-label="Close" onClick={close}>
                <Icon name="close" />
              </Button>
            </Tip>
          </header>
          <div className="min-h-0 flex-1 bg-white dark:bg-neutral-950">{body}</div>
        </Dialog.Popup>
      </Dialog.Portal>
      <Confirm
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard changes?"
        description={`The changes to "${entry.name}" have not been saved.`}
        confirmLabel="Discard"
        onConfirm={onClose}
      />
      <Confirm
        open={conflict !== null}
        onOpenChange={(o) => !o && setConflict(null)}
        title="The file has changed"
        description={`"${entry.name}" was changed by someone else since you opened it. Saving replaces those changes with yours.`}
        confirmLabel="Save anyway"
        onConfirm={() => conflict !== null && save.mutate({ text: conflict, overwrite: true })}
      />
    </Dialog.Root>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="grid size-full place-items-center p-4 text-center text-sm text-neutral-500">
      <p>{children}</p>
    </div>
  );
}
