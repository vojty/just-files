// Client for the just-files API (internal/server). Requests and types are
// generated from its OpenAPI document into ./client, see scripts/gen-api.sh.

import * as sdk from "./client/index.ts";
import type {
  DownloadFileData,
  ErrorModel,
  FileEntry,
  GetFileContentData,
  UploadFilesData,
} from "./client/index.ts";

export type { FileEntry, SearchResults } from "./client/index.ts";
export type FileKind = FileEntry["kind"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Result<T> = { data: T | undefined; error: unknown; response?: Response };

/** Returns the data of a generated SDK call, throwing ApiError on failure. */
async function call<T>(result: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await result;
  if (!response) {
    throw new ApiError(0, "Cannot reach the server");
  }
  if (error !== undefined || !response.ok) {
    throw new ApiError(
      response.status,
      problemText(error) ?? (response.statusText || `HTTP ${response.status}`),
    );
  }
  return data as T;
}

/** Returns the message of an API error (application/problem+json). */
function problemText(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const p = error as ErrorModel;
  const details = p.errors?.map((e) => e.message).filter(Boolean) ?? [];
  const text = [p.detail ?? p.title, ...details].filter(Boolean).join(": ");
  return text || undefined;
}

const query = (params: Record<string, string | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, String(v));
  }
  return q.toString();
};

export const api = {
  info: () => call(sdk.getInfo()),
  search: (path: string, q: string) => call(sdk.search({ query: { path, q } })),
  list: (path: string) => call(sdk.listFiles({ query: { path } })),
  mkdir: (path: string) => call(sdk.createFolder({ body: { path } })),
  move: (from: string, to: string) => call(sdk.moveFile({ body: { from, to } })),
  remove: (path: string) => call(sdk.deleteFile({ query: { path } })).then(() => undefined),
  downloadUrl: (path: string) =>
    `/api/files/download?${query({ path } satisfies DownloadFileData["query"])}`,
  /** URL showing the file in the browser; see the API on what it is safe for. */
  contentUrl: (path: string) =>
    `/api/files/content?${query({ path } satisfies GetFileContentData["query"])}`,
  /** The first limit bytes of a file as text, or null text for binary files. */
  textPreview: async (path: string, limit: number): Promise<TextPreview> => {
    const blob = await call(
      sdk.getFileContent({
        query: { path },
        headers: { Range: `bytes=0-${limit - 1}` },
        parseAs: "blob",
      }),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Text has no NUL bytes; nearly every binary format has some early on.
    if (bytes.subarray(0, 8192).includes(0)) return { text: null };
    // A cut multi-byte character at the end decodes as U+FFFD, which is fine.
    return { text: new TextDecoder().decode(bytes) };
  },
};

export interface TextPreview {
  text: string | null;
}

export interface UploadOptions {
  overwrite?: boolean;
  /** Create the folder and its parents if missing. */
  parents?: boolean;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Uploads one file into the folder dir. Uses XMLHttpRequest because fetch
 * does not report upload progress.
 */
export function uploadFile(dir: string, file: File, opts: UploadOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const params: UploadFilesData["query"] = {
      path: dir,
      overwrite: opts.overwrite || undefined,
      parents: opts.parents || undefined,
    };
    const url = `/api/files/upload?${query(params)}`;
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ApiError(xhr.status, problemText(xhr.response) ?? `HTTP ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new ApiError(0, "Upload failed: network error")));
    xhr.addEventListener("abort", () => reject(new DOMException("Upload cancelled", "AbortError")));
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

/** Joins a folder path from the API ("." is the root) with a name. */
export function joinPath(dir: string, name: string): string {
  return dir === "." || dir === "" ? name : `${dir}/${name}`;
}

/** Returns the parent folder of a path, "." for top-level entries. */
export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : path.slice(0, i);
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
