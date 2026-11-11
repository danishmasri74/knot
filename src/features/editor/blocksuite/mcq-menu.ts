import type { NoteBlockModel } from "@blocksuite/blocks";
import { guardMcqClipboard } from "./cited-excerpt-adapters";
import type { AffineEditorContainer } from "@blocksuite/presets";
import { html, render, type TemplateResult } from "lit";
import { shellIconPaths } from "../../../app/ShellIcon";
import {
  captureMcqTarget,
  captureNoteMcqTarget,
  requestMcqInsertion,
  type McqInsertionTarget,
} from "./mcq-insertion";

interface CanvasToolbar extends HTMLElement {
  registerEntry(entry: {
    when: (selection: readonly { id: string }[]) => boolean;
    render: () => TemplateResult;
  }): void;
  requestUpdate(): void;
}

const questionIcon = html`<svg
  data-icon="multipleChoice"
  width="20"
  height="20"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d=${shellIconPaths.multipleChoice}></path>
</svg>`;

export interface NewMcqRequest {
  doc: AffineEditorContainer["doc"];
}

interface NoteMenu extends HTMLElement {
  edgeless: {
    doc: AffineEditorContainer["doc"];
    gfx: { tool: { setTool(tool: string): void } };
  };
  toolbar?: { activePopper: { dispose(): void } | null };
}

// Docs whose canvas note menu may create a standalone question.
const noteMenuDocs = new Map<AffineEditorContainer["doc"], number>();
let noteMenuRegistered = false;

function registerNoteMenuTool() {
  if (noteMenuRegistered) return;
  noteMenuRegistered = true;
  void customElements.whenDefined("edgeless-note-menu").then((menuClass) => {
    // Patched BlockSuite hook: renders after Image, Link and File.
    (
      menuClass as unknown as {
        extraTools: Array<(menu: NoteMenu) => unknown>;
      }
    ).extraTools.push((menu) =>
      noteMenuDocs.has(menu.edgeless.doc) && !menu.edgeless.doc.readonly
        ? html`<edgeless-tool-icon-button
            aria-label="Multiple choice"
            .activeMode=${"background"}
            .tooltip=${"Multiple choice"}
            @click=${() => {
              const { doc, gfx } = menu.edgeless;
              gfx.tool.setTool("default");
              // The composer is modal; close the menu (and reset its tool button).
              menu.toolbar?.activePopper?.dispose();
              if (menu.toolbar) menu.toolbar.activePopper = null;
              window.dispatchEvent(
                new CustomEvent<NewMcqRequest>("knot-new-mcq", {
                  detail: { doc },
                }),
              );
            }}
            >${questionIcon}</edgeless-tool-icon-button
          >`
        : null,
    );
  });
}

export function observeMcqMenu(
  editor: AffineEditorContainer,
  allowInsertion = true,
) {
  let alive = true;
  const menuDoc = allowInsertion ? editor.doc : undefined;
  if (menuDoc) {
    registerNoteMenuTool();
    noteMenuDocs.set(menuDoc, (noteMenuDocs.get(menuDoc) ?? 0) + 1);
  }
  const canvasBars = new WeakSet<CanvasToolbar>();
  const slash = new Map<
    HTMLElementTagNameMap["affine-slash-menu-widget"],
    HTMLElementTagNameMap["affine-slash-menu-widget"]["config"]
  >();
  const format = new Set<HTMLElementTagNameMap["affine-format-bar-widget"]>();
  const refresh = () => {
    for (const widget of editor.querySelectorAll("affine-slash-menu-widget")) {
      if (slash.has(widget)) continue;
      const original = widget.config;
      slash.set(widget, original);
      widget.std.clipboard.use(guardMcqClipboard);
      if (!allowInsertion) continue;
      widget.config = {
        ...original,
        items: [
          ...original.items,
          {
            name: "Multiple choice",
            alias: ["mcq", "quiz"],
            icon: questionIcon,
            showWhen: ({ model }) => !!captureMcqTarget(editor, model),
            // BlockSuite removes the matched trigger and query before invoking action.
            action: ({ model }) =>
              requestMcqInsertion(captureMcqTarget(editor, model)),
          },
        ],
      };
    }
    if (!allowInsertion) return;
    for (const bar of editor.querySelectorAll<CanvasToolbar>(
      "edgeless-element-toolbar-widget",
    )) {
      if (canvasBars.has(bar)) continue;
      canvasBars.add(bar);
      let noteId: string | undefined;
      let target: McqInsertionTarget | undefined;
      bar.registerEntry({
        when: (selection) => {
          noteId = selection.length === 1 ? selection[0].id : undefined;
          const note = noteId
            ? (editor.doc.getBlock(noteId)?.model as NoteBlockModel | undefined)
            : undefined;
          return (
            alive &&
            !editor.doc.readonly &&
            note?.flavour === "affine:note" &&
            !note.isLocked() &&
            note.children.some((child) => child.flavour === "affine:paragraph")
          );
        },
        render: () =>
          html`<edgeless-tool-icon-button
            aria-label="Multiple choice"
            .tooltip=${"Multiple choice"}
            @pointerdown=${(event: PointerEvent) => {
              target = noteId
                ? captureNoteMcqTarget(editor, noteId)
                : undefined;
              event.preventDefault();
            }}
            @click=${() => {
              if (alive && noteId)
                requestMcqInsertion(
                  target ?? captureNoteMcqTarget(editor, noteId),
                );
              target = undefined;
            }}
            >${questionIcon}</edgeless-tool-icon-button
          >`,
      });
      bar.requestUpdate();
    }
    for (const toolbar of editor.querySelectorAll("affine-format-bar-widget")) {
      if (format.has(toolbar)) continue;
      format.add(toolbar);
      let target: McqInsertionTarget | undefined;
      toolbar.addInlineAction({
        id: "knot-multiple-choice",
        name: "Multiple choice",
        showWhen: () => !!captureMcqTarget(editor),
        isActive: () => false,
        icon: () => {
          const icon = document.createElement("span");
          render(questionIcon, icon);
          icon.addEventListener("pointerdown", (event) => {
            target = captureMcqTarget(editor);
            event.preventDefault();
          });
          return icon;
        },
        action: () => {
          requestMcqInsertion(target ?? captureMcqTarget(editor));
          target = undefined;
        },
      });
      toolbar.requestUpdate();
    }
  };
  const observer = new MutationObserver(() => {
    for (const [widget, config] of slash)
      if (!editor.contains(widget)) {
        widget.config = config;
        widget.std.clipboard.unuse(guardMcqClipboard);
        slash.delete(widget);
      }
    for (const widget of format)
      if (!editor.contains(widget)) removeFormat(widget);
    refresh();
  });
  function removeFormat(
    widget: HTMLElementTagNameMap["affine-format-bar-widget"],
  ) {
    format.delete(widget);
    widget.configItems = widget.configItems.filter(
      (item) => !("id" in item) || item.id !== "knot-multiple-choice",
    );
    widget.requestUpdate();
  }
  observer.observe(editor, { childList: true, subtree: true });
  refresh();
  return () => {
    alive = false;
    if (menuDoc) {
      const count = (noteMenuDocs.get(menuDoc) ?? 1) - 1;
      if (count > 0) noteMenuDocs.set(menuDoc, count);
      else noteMenuDocs.delete(menuDoc);
    }
    observer.disconnect();
    for (const [widget, config] of slash) {
      widget.config = config;
      widget.std.clipboard.unuse(guardMcqClipboard);
    }
    for (const widget of format) removeFormat(widget);
  };
}
