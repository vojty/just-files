// Shared, styled building blocks on top of Base UI.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button as BaseButton } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { Menu } from "@base-ui/react/menu";
import { Toast } from "@base-ui/react/toast";
import type { ComponentProps, ReactNode } from "react";
import { errorText } from "../api.ts";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/** plain: no size or colors, for buttons styled entirely by the caller. */
type Variant = "primary" | "secondary" | "danger" | "ghost" | "plain";

const variants: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 data-disabled:bg-indigo-600/50",
  secondary:
    "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800",
  danger: "bg-red-600 text-white hover:bg-red-500 data-disabled:bg-red-600/50",
  ghost:
    "text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
  plain: "",
};

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";

export const buttonClass = (variant: Variant = "secondary", extra?: string) =>
  cx(
    variant !== "plain" &&
      "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap select-none transition-colors data-disabled:cursor-not-allowed data-disabled:opacity-60",
    focusRing,
    variants[variant],
    extra,
  );

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: Omit<ComponentProps<typeof BaseButton>, "className"> & {
  variant?: Variant;
  className?: string;
}) {
  return <BaseButton type={type} className={buttonClass(variant, className)} {...props} />;
}

const inputClass =
  "h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-2 focus:-outline-offset-1 focus:outline-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:disabled:bg-neutral-800";

export function TextInput({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "className"> & { className?: string }) {
  return <Input className={cx(inputClass, className)} {...props} />;
}

/** A labelled text field showing error while invalid. */
export function TextField({
  label,
  error,
  invalid,
  ...props
}: Omit<ComponentProps<typeof Field.Control>, "className"> & {
  label: string;
  error: string;
  invalid: boolean;
}) {
  return (
    <Field.Root invalid={invalid} className="flex flex-col gap-1">
      <Field.Label className="sr-only">{label}</Field.Label>
      <Field.Control className={inputClass} {...props} />
      <Field.Error match className="text-xs text-red-600 dark:text-red-400">
        {error}
      </Field.Error>
    </Field.Root>
  );
}

/** Classes of menu popups, for Menu and ContextMenu, which share their parts. */
export const menuPopupClass =
  "min-w-44 origin-(--transform-origin) rounded-lg border border-neutral-200 bg-white p-1 shadow-lg outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 dark:border-neutral-800 dark:bg-neutral-900";

/** A drop-down menu opened by trigger, which renders the trigger's button. */
export function DropdownMenu({
  trigger,
  children,
}: {
  trigger: ComponentProps<typeof Menu.Trigger>;
  children: ReactNode;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger {...trigger} />
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-40 outline-none">
          <Menu.Popup className={menuPopupClass}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function MenuItem({
  icon,
  danger = false,
  children,
  ...props
}: Omit<ComponentProps<typeof Menu.Item>, "className"> & {
  icon: IconName;
  danger?: boolean;
}) {
  return (
    <Menu.Item
      className={cx(
        "flex cursor-default items-center gap-2.5 rounded px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-neutral-100 dark:data-highlighted:bg-neutral-800",
        danger && "text-red-600 dark:text-red-400",
      )}
      {...props}
    >
      <Icon name={icon} className={danger ? undefined : "text-neutral-500 dark:text-neutral-400"} />
      {children}
    </Menu.Item>
  );
}

/** A menu item ticking an option on and off; the menu stays open. */
export function MenuCheckboxItem({
  children,
  ...props
}: Omit<ComponentProps<typeof Menu.CheckboxItem>, "className">) {
  return (
    <Menu.CheckboxItem
      className="flex cursor-default items-center gap-2.5 rounded px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-neutral-100 dark:data-highlighted:bg-neutral-800"
      {...props}
    >
      <span className="grid size-4 place-items-center">
        <Menu.CheckboxItemIndicator>
          <Icon name="check" className="text-indigo-600 dark:text-indigo-400" />
        </Menu.CheckboxItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.Group>
      <Menu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-neutral-500">
        {label}
      </Menu.GroupLabel>
      {children}
    </Menu.Group>
  );
}

export function MenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" />;
}

export const backdropClass =
  "fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60";

const popupClass =
  "fixed z-50 top-1/2 left-1/2 flex w-md max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl bg-white p-5 shadow-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800";

/** A controlled modal dialog with a title and optional description. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={popupClass}>
          <div className="flex flex-col gap-1">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            {description && (
              <Dialog.Description className="text-sm break-all text-neutral-500 dark:text-neutral-400">
                {description}
              </Dialog.Description>
            )}
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A controlled confirmation dialog for destructive actions. */
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={popupClass}>
          <div className="flex flex-col gap-1">
            <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm break-all text-neutral-500 dark:text-neutral-400">
              {description}
            </AlertDialog.Description>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialog.Close className={buttonClass("secondary")}>Cancel</AlertDialog.Close>
            <AlertDialog.Close className={buttonClass("danger")} onClick={onConfirm}>
              {confirmLabel}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export const toastManager = Toast.createToastManager();

export function notify(title: string, type: "success" | "error" = "success", description?: string) {
  toastManager.add({ title, description, type, timeout: type === "error" ? 8000 : 4000 });
}

export function notifyError(err: unknown, title = "Something went wrong") {
  notify(title, "error", errorText(err));
}

export function Toasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-60 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className={cx(
              "flex items-start gap-3 rounded-lg border bg-white p-3 shadow-lg transition-[opacity,translate] duration-200 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 dark:bg-neutral-900",
              toast.type === "error"
                ? "border-red-300 dark:border-red-900"
                : "border-neutral-200 dark:border-neutral-800",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Toast.Title
                className={cx(
                  "text-sm font-semibold",
                  toast.type === "error" && "text-red-600 dark:text-red-400",
                )}
              />
              <Toast.Description className="text-sm break-words text-neutral-600 dark:text-neutral-400" />
            </div>
            <Toast.Close
              aria-label="Dismiss"
              className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <Icon name="close" />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

const iconPaths = {
  folder: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  video: "M4 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm12 5 5-3v10l-5-3",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  audio: "M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  text: "M6 3h8l5 5v13H6zM14 3v5h5M9 13h6M9 17h6",
  archive: "M4 4h16v4H4zM5 8v12h14V8M10 12h4",
  file: "M6 3h8l5 5v13H6zM14 3v5h5",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  plus: "M12 5v14M5 12h14",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "m9 6 6 6-6 6",
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  folderPlus:
    "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6",
  folderOpen: "M3 6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1M3 6v12a2 2 0 0 0 2 2h12l4-9H7l-4 9",
  download: "M12 4v12m0 0-4-4m4 4 4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  pencil: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  move: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 13h6m-2-2 2 2-2 2",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  check: "m5 12 5 5L20 7",
  columns: "M4 5h16v14H4zM10 5v14M15 5v14",
  arrowUp: "M12 19V5m0 0-6 6m6-6 6 6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  wrap: "M4 6h16M4 12h13a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M4 18h5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4.35-4.35",
  sidebar: "M4 5h16v14H4zM9 5v14",
} as const;

type IconName = keyof typeof iconPaths;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("size-4 shrink-0", className)}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
