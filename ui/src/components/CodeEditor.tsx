// A CodeMirror 6 editor for the text of one file. It is a separate chunk,
// loaded the first time a file is edited (see FileEditor), as is the grammar
// of each language.
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, Prec, type Text } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { LanguageDescription } from "@codemirror/language";
import { useEffect, useRef, type RefObject } from "react";

export interface EditorHandle {
  /** The text being edited. */
  text: () => string;
}

const dark = window.matchMedia("(prefers-color-scheme: dark)");

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.625" },
});

export default function CodeEditor({
  name,
  initial,
  saved,
  wrap,
  handle,
  onDirtyChange,
  onSave,
}: {
  /** File name, which tells the language. */
  name: string;
  /** Text the editor starts with. */
  initial: string;
  /** Text of the file as saved, to tell whether there are changes. */
  saved: string;
  wrap: boolean;
  handle: RefObject<EditorHandle | null>;
  onDirtyChange: (dirty: boolean) => void;
  /** Ctrl+S (⌘S) pressed. */
  onSave: () => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const savedDoc = useRef<Text>(null);
  const wrapping = useRef(new Compartment());
  // Callbacks change with every render; the editor calls the latest.
  const callbacks = useRef({ onDirtyChange, onSave });
  callbacks.current = { onDirtyChange, onSave };

  const isDirty = (doc: Text) => !savedDoc.current || !doc.eq(savedDoc.current);

  useEffect(() => {
    const theme = new Compartment();
    const language = new Compartment();
    // CodeMirror splits lines at any line break and joins them with this one,
    // so files keep Windows line breaks.
    const lineSeparator = initial.includes("\r\n") ? "\r\n" : "\n";
    const v = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: "Mod-s",
                run: () => {
                  callbacks.current.onSave();
                  return true;
                },
              },
            ]),
          ),
          basicSetup,
          EditorState.lineSeparator.of(lineSeparator),
          baseTheme,
          theme.of(dark.matches ? oneDark : []),
          language.of([]),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onDirtyChange(isDirty(u.state.doc));
          }),
        ],
      }),
    });
    view.current = v;
    handle.current = { text: () => v.state.doc.toString() };
    v.focus();

    const onScheme = () => v.dispatch({ effects: theme.reconfigure(dark.matches ? oneDark : []) });
    dark.addEventListener("change", onScheme);
    // Escape closes the dialog, unless the editor used it, e.g. to close
    // its search panel. CodeMirror prevents the default of keys it handles.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && e.defaultPrevented) e.stopPropagation();
    };
    v.dom.addEventListener("keydown", onKeyDown);

    let cancelled = false;
    void LanguageDescription.matchFilename(languages, name)
      ?.load()
      .then((support) => {
        if (!cancelled) v.dispatch({ effects: language.reconfigure(support) });
      });

    return () => {
      cancelled = true;
      dark.removeEventListener("change", onScheme);
      v.dom.removeEventListener("keydown", onKeyDown);
      v.destroy();
      view.current = null;
      handle.current = null;
    };
    // The editor is created once; FileEditor remounts it for another file.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current!;
    savedDoc.current = v.state.toText(saved);
    onDirtyChange(isDirty(v.state.doc));
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  return <div ref={parent} className="size-full" />;
}
