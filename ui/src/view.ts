// How listings are shown: the visible columns and the sort order of folders.
// Remembered per browser; kept outside React so every table shares it.
import { useSyncExternalStore } from "react";

const COLUMNS = ["type", "size", "modified", "permissions", "owner", "group"] as const;
export type ColumnId = (typeof COLUMNS)[number];

/** "folder" sorts search results by the folder they are in. */
export type SortKey = "name" | "folder" | ColumnId;
export interface Sort {
  by: SortKey;
  desc: boolean;
}

export interface View {
  /** Every column in the order the user arranged them, shown or not. */
  order: ColumnId[];
  /** The visible columns, in that order. */
  columns: ColumnId[];
  sort: Sort;
}

const KEY = "just-files.view";
const DEFAULT: View = {
  order: [...COLUMNS],
  columns: ["type", "size", "modified"],
  sort: { by: "name", desc: false },
};

const isColumn = (c: unknown): c is ColumnId => COLUMNS.includes(c as ColumnId);

function load(): View {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<View> | null;
    if (!v) return DEFAULT;
    // Columns missing from a stored order, e.g. ones added later, go last.
    const stored = Array.isArray(v.order) ? v.order.filter(isColumn) : [];
    const order = [...new Set([...stored, ...COLUMNS])];
    const shown = Array.isArray(v.columns) ? v.columns.filter(isColumn) : DEFAULT.columns;
    const columns = order.filter((c) => shown.includes(c));
    const sort =
      v.sort && (v.sort.by === "name" || isColumn(v.sort.by))
        ? { by: v.sort.by, desc: Boolean(v.sort.desc) }
        : DEFAULT.sort;
    return { order, columns, sort };
  } catch {
    // Unavailable or invalid storage: start from the defaults.
    return DEFAULT;
  }
}

let view = load();
const listeners = new Set<() => void>();

function set(patch: Partial<View>) {
  view = { ...view, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Not remembered then.
  }
  for (const l of listeners) l();
}

export function useView() {
  const v = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => view,
  );
  return {
    ...v,
    setSort: (sort: Sort) => set({ sort }),
    /** Shows or hides a column, keeping columns in the user's order. */
    toggleColumn: (id: ColumnId, show: boolean) =>
      set({ columns: v.order.filter((c) => (c === id ? show : v.columns.includes(c))) }),
    /** Moves column id just before, or with after just after, column target. */
    moveColumn: (id: ColumnId, target: ColumnId, after: boolean) => {
      if (id === target) return;
      const order = v.order.filter((c) => c !== id);
      order.splice(order.indexOf(target) + Number(after), 0, id);
      set({ order, columns: order.filter((c) => v.columns.includes(c)) });
    },
  };
}
