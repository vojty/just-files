// A right-click (or long-press) menu for an area listing files and folders.
// One menu serves the whole area: elements inside mark which entry they stand
// for with useContextEntry, and anywhere else the menu acts on the area's folder.
import { ContextMenu } from "@base-ui/react/context-menu";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { FileEntry } from "../api.ts";
import { EntryMenuItems, FolderMenuItems, type OnAction } from "./actions.tsx";
import { menuPopupClass } from "./ui.tsx";

interface Target {
  set: (entry: FileEntry) => void;
  /** Path of the entry the open menu acts on. */
  open: string | null;
}

const TargetContext = createContext<Target>({ set: () => {}, open: null });

export function FileContextMenu({
  folder,
  onAction,
  className,
  children,
}: {
  /** The folder the menu acts on outside of entries. */
  folder: string;
  onAction: OnAction;
  className?: string;
  children: ReactNode;
}) {
  const [entry, setEntry] = useState<FileEntry | null>(null);
  const [open, setOpen] = useState(false);
  // Capture handlers run before the entries' own ones, which set the entry.
  const reset = () => setEntry(null);

  return (
    <TargetContext value={{ set: setEntry, open: open ? (entry?.path ?? null) : null }}>
      <ContextMenu.Root open={open} onOpenChange={setOpen}>
        <ContextMenu.Trigger
          className={className}
          onPointerDownCapture={reset}
          onContextMenuCapture={reset}
        >
          {children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-40 outline-none">
            <ContextMenu.Popup className={menuPopupClass}>
              {entry ? (
                <EntryMenuItems entry={entry} onAction={onAction} />
              ) : (
                <FolderMenuItems dir={folder} onAction={onAction} />
              )}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </TargetContext>
  );
}

/**
 * Props marking an element as standing for entry in the surrounding
 * FileContextMenu, and whether the menu is open for it.
 */
export function useContextEntry(entry: FileEntry | undefined) {
  const target = useContext(TargetContext);
  if (!entry) return { props: {}, menuOpen: false };
  const select = () => target.set(entry);
  return {
    // pointerdown covers long presses on touch screens, contextmenu the
    // keyboard's menu key.
    props: { onPointerDown: select, onContextMenu: select },
    menuOpen: target.open === entry.path,
  };
}
