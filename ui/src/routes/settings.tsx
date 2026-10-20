import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useId } from "react";
import { api, type Settings } from "../api.ts";
import { Icon, notify, notifyError, Switch } from "../components/ui.tsx";
import { queries } from "../queries.ts";

export const Route = createFileRoute("/settings")({
  loader: ({ context }) => context.queryClient.ensureQueryData(queries.settings()),
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery(queries.settings());
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (saved: Settings) => {
      queryClient.setQueryData(queries.settings().queryKey, saved);
      // Listings and search change with what is shown.
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      notify("Settings saved");
    },
    onError: (err) => notifyError(err, "Settings could not be saved"),
  });
  const hiddenId = useId();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-neutral-200/70 dark:hover:bg-neutral-800"
        >
          <Icon name="chevron" className="rotate-180" />
          Back to files
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-neutral-500">
          Settings apply at once, for everyone using this server.
        </p>
        <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start gap-4 p-4">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={hiddenId} className="text-sm font-medium">
                Show hidden files
              </label>
              <p className="text-sm text-neutral-500">
                Files and folders whose names start with a dot, like <code>.env</code> or{" "}
                <code>.git</code>. While shown, they can be found, opened, changed and deleted like
                any other file.
              </p>
              <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                <Icon name="lock" className="mt-0.5" />
                <span>
                  Hidden files often hold secrets, such as SSH keys in <code>.ssh</code>. There is
                  no login, so anyone who can reach this server can then read them.
                </span>
              </p>
            </div>
            <Switch
              id={hiddenId}
              checked={settings.showHidden}
              disabled={save.isPending}
              onCheckedChange={(showHidden) => save.mutate({ ...settings, showHidden })}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
