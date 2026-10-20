import { Toast } from "@base-ui/react/toast";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { UploadQueue } from "../components/UploadQueue.tsx";
import { Toasts, toastManager } from "../components/ui.tsx";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => <p className="p-4 text-sm text-neutral-500">Page not found.</p>,
});

function RootLayout() {
  return (
    <Toast.Provider toastManager={toastManager}>
      <Outlet />
      <UploadQueue />
      <Toasts />
    </Toast.Provider>
  );
}
