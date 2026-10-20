// Drag and drop shared by the folder tree and the listing: entries dragged
// onto a folder are moved there, files dragged in from the desktop are
// uploaded.
import { useRef, useState, type DragEvent } from "react";
import { parentPath, type FileEntry } from "./api.ts";
import { droppedFiles, type UploadItem } from "./dropped.ts";

/** Drag data type marking a drag of an entry within the page. */
const ENTRY_DRAG_TYPE = "application/x-just-files-entry";

/** Event handlers making an element a target for dropped entries and files. */
interface DropZone {
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

export interface DragDrop {
  /** Makes an element a drop target moving entries, or uploading files, into the folder target. */
  dropZone: (target: string) => DropZone;
  /** Makes an element a drag source for entry. */
  draggable: (entry: FileEntry) => {
    draggable: true;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  /** Handlers for the area where files dropped outside any drop zone go to fallback. */
  area: (fallback: string) => {
    onDragEnter: (e: DragEvent<HTMLElement>) => void;
    onDragLeave: () => void;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
  };
  /** The folder a drag is over, if it can be dropped there. */
  dropTarget: string | null;
  /** Files from outside the page are dragged over the area. */
  draggingFiles: boolean;
}

const hasFiles = (dt: DataTransfer) => dt.types.includes("Files");

export function useDragDrop({
  onMove,
  onUpload,
}: {
  onMove: (entry: FileEntry, target: string) => void;
  onUpload: (target: string, items: UploadItem[]) => void;
}): DragDrop {
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  // The entry being dragged within the page, and the folder it would be dropped into.
  const dragged = useRef<FileEntry | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function endDrag() {
    dragDepth.current = 0;
    dragged.current = null;
    setDraggingFiles(false);
    setDropTarget(null);
  }

  function upload(target: string, dt: DataTransfer) {
    // Read synchronously: the browser empties dt after the event.
    void droppedFiles(dt).then((items) => items.length > 0 && onUpload(target, items));
  }

  /** Whether the drag can be dropped into the folder target. */
  function canDrop(target: string, dt: DataTransfer) {
    if (hasFiles(dt)) return true;
    const entry = dragged.current;
    if (!entry || !dt.types.includes(ENTRY_DRAG_TYPE)) return false;
    return (
      target !== entry.path &&
      target !== parentPath(entry.path) &&
      !target.startsWith(`${entry.path}/`)
    );
  }

  return {
    dropTarget,
    draggingFiles,
    dropZone: (target) => ({
      onDragOver: (e) => {
        if (!canDrop(target, e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dragged.current ? "move" : "copy";
        setDropTarget(target);
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropTarget((t) => (t === target ? null : t));
      },
      onDrop: (e) => {
        if (!canDrop(target, e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const entry = dragged.current;
        endDrag();
        if (hasFiles(e.dataTransfer)) upload(target, e.dataTransfer);
        else if (entry) onMove(entry, target);
      },
    }),
    draggable: (entry) => ({
      draggable: true,
      onDragStart: (e) => {
        dragged.current = entry;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(ENTRY_DRAG_TYPE, entry.path);
      },
      onDragEnd: endDrag,
    }),
    area: (fallback) => ({
      onDragEnter: (e) => {
        if (!hasFiles(e.dataTransfer)) return;
        dragDepth.current++;
        setDraggingFiles(true);
      },
      onDragLeave: () => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDraggingFiles(false);
      },
      onDragOver: (e) => {
        if (hasFiles(e.dataTransfer)) e.preventDefault();
      },
      onDrop: (e) => {
        e.preventDefault();
        const files = hasFiles(e.dataTransfer);
        endDrag();
        if (files) upload(fallback, e.dataTransfer);
      },
    }),
  };
}
