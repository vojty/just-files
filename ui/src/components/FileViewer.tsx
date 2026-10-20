// Shows a file's content in a dialog: images, video, audio and PDFs with the
// browser's own viewers, anything else as text when it is text. The arrow
// keys step through the other files of the folder in the listing's order.
import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  api,
  describeError,
  formatSize,
  isClientError,
  parentPath,
  type FileEntry,
} from "../api.ts";
import { queries, TEXT_PREVIEW_LIMIT } from "../queries.ts";
import { useView } from "../view.ts";
import { FileIcon } from "./FileIcon.tsx";
import { sortEntries, typeLabel } from "./FileTable.tsx";
import { backdropClass, Button, buttonClass, cx, Icon } from "./ui.tsx";

type Viewer = "image" | "video" | "audio" | "pdf" | "text";

function viewerFor(e: FileEntry): Viewer {
  if (e.kind === "image" || e.kind === "video" || e.kind === "audio") return e.kind;
  if (e.name.toLowerCase().endsWith(".pdf")) return "pdf";
  // Text, or files of unknown type that may be text: the preview tells.
  return "text";
}

export function FileViewer({ entry: first, onClose }: { entry: FileEntry; onClose: () => void }) {
  const [entry, setEntry] = useState(first);
  const [wrap, setWrap] = useState(false);
  const { sort } = useView();
  const { data: listing } = useQuery(queries.files(parentPath(entry.path)));
  const files = useMemo(
    () => (listing ? sortEntries(listing.entries, sort).filter((e) => !e.isDir) : []),
    [listing, sort],
  );
  const i = files.findIndex((f) => f.path === entry.path);
  const prev = i > 0 ? files[i - 1] : undefined;
  const next = i >= 0 && i < files.length - 1 ? files[i + 1] : undefined;
  const viewer = viewerFor(entry);

  function onKeyDown(e: KeyboardEvent) {
    // Players use the arrow keys for seeking.
    if (e.target instanceof HTMLMediaElement) return;
    const to = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : undefined;
    if (to) {
      e.preventDefault();
      setEntry(to);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          onKeyDown={onKeyDown}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:inset-6 dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-neutral-200 py-2 pr-2 pl-4 dark:border-neutral-800">
            <FileIcon name={entry.name} className="size-6" fallback={null} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Dialog.Title className="truncate text-sm font-semibold" title={entry.name}>
                {entry.name}
              </Dialog.Title>
              <Dialog.Description className="truncate text-xs text-neutral-500">
                {typeLabel(entry)} · {formatSize(entry.size)}
                {files.length > 1 && i >= 0 && ` · ${i + 1} of ${files.length}`}
              </Dialog.Description>
            </div>
            {viewer === "text" && (
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
            )}
            <Button
              variant="ghost"
              className="h-8 w-8 px-0"
              aria-label="Previous file"
              disabled={!prev}
              onClick={() => prev && setEntry(prev)}
            >
              <Icon name="chevron" className="rotate-180" />
            </Button>
            <Button
              variant="ghost"
              className="h-8 w-8 px-0"
              aria-label="Next file"
              disabled={!next}
              onClick={() => next && setEntry(next)}
            >
              <Icon name="chevron" />
            </Button>
            <a
              href={api.contentUrl(entry.path)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in a new tab"
              className={buttonClass("ghost", "h-8 w-8 px-0")}
            >
              <Icon name="external" />
            </a>
            <a
              href={api.downloadUrl(entry.path)}
              aria-label="Download"
              className={buttonClass("ghost", "h-8 w-8 px-0")}
            >
              <Icon name="download" />
            </a>
            <Dialog.Close aria-label="Close" className={buttonClass("ghost", "h-8 w-8 px-0")}>
              <Icon name="close" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 bg-neutral-50 dark:bg-neutral-950">
            <Preview key={entry.path} entry={entry} viewer={viewer} wrap={wrap} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Preview({ entry, viewer, wrap }: { entry: FileEntry; viewer: Viewer; wrap: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = api.contentUrl(entry.path);
  if (failed) return <MediaError entry={entry} />;

  const media = "max-h-full max-w-full";
  switch (viewer) {
    case "image":
      return (
        <Centered>
          <img
            src={src}
            alt={entry.name}
            className={cx(media, "object-contain")}
            onError={() => setFailed(true)}
          />
        </Centered>
      );
    case "video":
      return (
        <Centered>
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- users' own videos, captions unknown */}
          <video src={src} controls autoPlay className={media} onError={() => setFailed(true)} />
        </Centered>
      );
    case "audio":
      return (
        <Centered>
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- users' own audio, captions unknown */}
          <audio
            src={src}
            controls
            autoPlay
            className="w-full max-w-lg"
            onError={() => setFailed(true)}
          />
        </Centered>
      );
    case "pdf":
      return (
        // Browsers do not show PDFs in sandboxed frames. The server labels
        // .pdf files application/pdf, which browsers never run as a page.
        // oxlint-disable-next-line react/iframe-missing-sandbox
        <iframe src={src} title={entry.name} className="size-full" />
      );
    case "text":
      return <TextPreview entry={entry} wrap={wrap} />;
  }
}

function TextPreview({ entry, wrap }: { entry: FileEntry; wrap: boolean }) {
  const { data, error } = useQuery(queries.textPreview(entry.path, entry.modTime));
  const text = data?.text;
  // Shown once ready; until then, and for unknown languages, plain text.
  const { data: html } = useQuery({
    ...queries.highlight(entry.path, entry.modTime, text ?? ""),
    enabled: typeof text === "string",
  });
  const wrapClass = wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre";
  if (error) {
    return (
      <NoPreview entry={entry} download={!isClientError(error)}>
        {describeError(error, "this file")}
      </NoPreview>
    );
  }
  if (!data) return <Centered>Loading…</Centered>;
  if (data.text === null) {
    return <NoPreview entry={entry}>There is no preview for this kind of file.</NoPreview>;
  }
  return (
    <div className="flex size-full flex-col">
      {entry.size > TEXT_PREVIEW_LIMIT && (
        <p className="shrink-0 border-b border-neutral-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:border-neutral-800 dark:bg-amber-950/40 dark:text-amber-300">
          Showing the first {formatSize(TEXT_PREVIEW_LIMIT)} of {formatSize(entry.size)}.
        </p>
      )}
      {html ? (
        <div
          className={cx(
            "min-h-0 flex-1 overflow-auto text-[13px] leading-relaxed [&_pre]:min-h-full [&_pre]:p-4 [&_pre]:font-mono",
            wrap ? "[&_pre]:break-words [&_pre]:whitespace-pre-wrap" : "[&_pre]:whitespace-pre",
          )}
          // Shiki escapes the file's text; the HTML is only its markup.
          // oxlint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className={cx(
            "min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed",
            wrapClass,
          )}
        >
          {data.text}
        </pre>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid size-full place-items-center overflow-auto p-4 text-sm text-neutral-500">
      {children}
    </div>
  );
}

/** Why an image, video or audio file could not be shown: the file, or the browser. */
function MediaError({ entry }: { entry: FileEntry }) {
  const { error, isPending } = useQuery(queries.readable(entry.path));
  if (isPending) return <Centered>Loading…</Centered>;
  if (error) {
    return (
      <NoPreview entry={entry} download={false}>
        {describeError(error, "this file")}
      </NoPreview>
    );
  }
  return <NoPreview entry={entry}>The browser cannot show this file.</NoPreview>;
}

function NoPreview({
  entry,
  download = true,
  children,
}: {
  entry: FileEntry;
  /** Offer to download the file, pointless when it cannot be read. */
  download?: boolean;
  children: ReactNode;
}) {
  return (
    <Centered>
      <div className="flex flex-col items-center gap-3 text-center">
        <Icon name="file" className="size-10 text-neutral-300 dark:text-neutral-600" />
        <p>{children}</p>
        {download && (
          <a href={api.downloadUrl(entry.path)} className={buttonClass("secondary")}>
            <Icon name="download" />
            Download
          </a>
        )}
      </div>
    </Centered>
  );
}
