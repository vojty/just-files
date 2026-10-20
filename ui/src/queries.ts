// TanStack Query options for the API. Route loaders prefetch with them
// (queryClient.ensureQueryData) and components read with useSuspenseQuery.
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { api } from "./api.ts";
import { highlight } from "./highlight.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Loaders have just fetched the data; don't fetch it again on mount.
      staleTime: 10_000,
    },
  },
});

/** How much of a text file the viewer shows. */
export const TEXT_PREVIEW_LIMIT = 1024 * 1024;

export const queries = {
  /** Listing of one folder; invalidate ["files"] to refresh every folder. */
  files: (path: string) =>
    queryOptions({
      queryKey: ["files", path],
      queryFn: () => api.list(path),
    }),
  /** The icon mapping, fetched separately as it is large; see fileIcons.ts. */
  fileIcons: () =>
    queryOptions({
      queryKey: ["file-icons"],
      queryFn: () => import("virtual:file-icons").then((m) => m.default),
      staleTime: Infinity,
    }),
  info: () =>
    queryOptions({
      queryKey: ["info"],
      queryFn: () => api.info(),
      staleTime: Infinity,
    }),
  /** The start of a file as text, see api.textPreview. */
  textPreview: (path: string, modTime: string) =>
    queryOptions({
      // A changed file gets a new key.
      queryKey: ["preview", path, modTime],
      queryFn: () => api.textPreview(path, TEXT_PREVIEW_LIMIT),
      staleTime: Infinity,
    }),
  /** text of the file at path, highlighted by its name; see highlight. */
  highlight: (path: string, modTime: string, text: string) =>
    queryOptions({
      queryKey: ["highlight", path, modTime],
      queryFn: () => highlight(path, text),
      staleTime: Infinity,
    }),
  /** Search below the folder path; invalidate ["search"] after changes. */
  search: (path: string, q: string) =>
    queryOptions({
      queryKey: ["search", path, q],
      queryFn: () => api.search(path, q),
      // The index catches up with changes within seconds.
      staleTime: 0,
    }),
};
