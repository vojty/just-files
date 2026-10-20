import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { queries, queryClient } from "./queries.ts";
import { routeTree } from "./routeTree.gen.ts";
import { onUploadDone } from "./uploads.ts";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  // Caching is up to TanStack Query; always run loaders so they can consult it.
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 300,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Show newly uploaded files in their folder, and new folders of folder uploads
// in every listing. A folder upload finishes many files in a row; reuse running
// refetches instead of restarting them for each.
onUploadDone((u) => {
  const opts = { cancelRefetch: false };
  const files = u.parents ? ["files"] : queries.files(u.dir).queryKey;
  void queryClient.invalidateQueries({ queryKey: files }, opts);
  void queryClient.invalidateQueries({ queryKey: ["search"] }, opts);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
