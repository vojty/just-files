// Reading files to upload from drops and file inputs, including whole folders.

/** A file to upload, and the folder below the target to put it in ("" for the target itself). */
export interface UploadItem {
  file: File;
  dir: string;
}

/**
 * Dot files, such as .DS_Store, are left out unless the server shows hidden
 * files: it rejects them otherwise.
 */
const hidden = (name: string) => name.startsWith(".");

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/**
 * Returns the files of a drop, walking dropped folders. Call it during the
 * drop event: browsers empty the DataTransfer afterwards. Reading folders
 * continues asynchronously.
 */
export function droppedFiles(dt: DataTransfer, includeHidden = false): Promise<UploadItem[]> {
  const entries = Array.from(dt.items, (item) =>
    item.kind === "file" ? item.webkitGetAsEntry() : null,
  ).filter((e) => e !== null);
  if (entries.length === 0) {
    // No entry API: plain files only.
    return Promise.resolve(fromFiles(Array.from(dt.files), includeHidden));
  }
  return (async () => {
    const out: UploadItem[] = [];
    for (const entry of entries) await walk(entry, "", out, includeHidden);
    return out;
  })();
}

async function walk(
  entry: FileSystemEntry,
  dir: string,
  out: UploadItem[],
  includeHidden: boolean,
) {
  if (!includeHidden && hidden(entry.name)) return;
  if (isFile(entry)) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, dir });
  } else if (isDirectory(entry)) {
    const sub = join(dir, entry.name);
    for (const child of await readAll(entry)) await walk(child, sub, out, includeHidden);
  }
}

/** Reads all children of a folder; each readEntries call returns at most ~100. */
async function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

const isFile = (e: FileSystemEntry): e is FileSystemFileEntry => e.isFile;
const isDirectory = (e: FileSystemEntry): e is FileSystemDirectoryEntry => e.isDirectory;

/**
 * Returns the files picked with a file input. Files picked as a folder
 * (webkitdirectory) keep their place within it.
 */
export function fromFiles(files: Iterable<File>, includeHidden = false): UploadItem[] {
  const out: UploadItem[] = [];
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split("/");
    if (!includeHidden && parts.some(hidden)) continue;
    out.push({ file, dir: parts.slice(0, -1).join("/") });
  }
  return out;
}
