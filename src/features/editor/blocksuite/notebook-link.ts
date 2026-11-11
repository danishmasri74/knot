import { BlockViewIdentifier, type ExtensionType } from "@blocksuite/block-std";
import type { BlockModel } from "@blocksuite/store";
import { html, type TemplateResult } from "lit";
import { literal } from "lit/static-html.js";
import { shellIconPaths } from "../../../app/ShellIcon";

export const notebookLinkWidth = 252;
export const notebookLinkHeight = 60;

export const NotebookLinkSpec: ExtensionType = {
  setup(di) {
    di.override(
      BlockViewIdentifier("affine:embed-linked-doc"),
      () => (model: BlockModel) => {
        const canvas = model.parent?.flavour === "affine:surface";
        const props = model as unknown as LinkedDocView["model"];
        if (props.params || props.style !== "horizontalThin")
          return canvas
            ? literal`affine-embed-edgeless-linked-doc-block`
            : literal`affine-embed-linked-doc-block`;
        return canvas
          ? literal`knot-canvas-notebook-link`
          : literal`knot-page-notebook-link`;
      },
    );
  },
};

type LinkedDocView = HTMLElement & {
  model: { style: string; params?: object };
  linkedDoc?: {
    meta?: { title?: string };
    collection: {
      meta: {
        docMetaUpdated: { on: (callback: () => void) => { dispose(): void } };
      };
    };
  };
  disposables: { add(disposable: { dispose(): void }): void };
  connectedCallback(): void;
  open(): void;
  requestUpdate(): void;
  renderBlock(): TemplateResult;
  renderEmbed(content: () => TemplateResult): TemplateResult;
};

export function registerNotebookLinks() {
  for (const [tag, base] of [
    ["knot-page-notebook-link", "affine-embed-linked-doc-block"],
    ["knot-canvas-notebook-link", "affine-embed-edgeless-linked-doc-block"],
  ]) {
    if (customElements.get(tag)) continue;
    const NativeLink = customElements.get(base) as new () => LinkedDocView;
    class NotebookLink extends NativeLink {
      connectedCallback() {
        super.connectedCallback();
        const metadata = this.linkedDoc?.collection.meta;
        if (metadata)
          this.disposables.add(
            metadata.docMetaUpdated.on(() => this.requestUpdate()),
          );
      }
      renderBlock() {
        const title =
          this.linkedDoc?.meta?.title?.trim() ||
          (this.linkedDoc ? "Untitled notebook" : "Unavailable notebook");
        return this.renderEmbed(
          () => html`
            <div class="notebook-link-tile">
              ${icon("notebook")}
              <span class="notebook-link-title">
                <strong title=${title}>${title}</strong>
                <small>Notebook link</small>
              </span>
              <button
                type="button"
                aria-label=${"Open " + title}
                ?disabled=${!this.linkedDoc}
                @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
                @click=${(event: MouseEvent) => {
                  event.stopPropagation();
                  this.open();
                }}
              >
                ${icon("external")}
              </button>
            </div>
          `,
        );
      }
    }
    customElements.define(tag, NotebookLink);
  }
}

function icon(name: "notebook" | "external") {
  return html`<svg
    class="shell-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d=${shellIconPaths[name]} />
  </svg>`;
}
