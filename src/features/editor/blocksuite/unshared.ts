// "Not shared" references (NOTEBOOK-SHARING-PLAN.md, slice 4). When an
// imported notebook points at a notebook its sender didn't include, the
// reference keeps its ID and shows the recorded title with "Not shared"
// instead of BlockSuite's "Deleted doc". It fills in by itself if that notebook
// is imported later, because the ID is unchanged.
import {
  BlockViewIdentifier,
  StdIdentifier,
  type ExtensionType,
} from "@blocksuite/block-std";
import {
  DocDisplayMetaProvider,
  DocDisplayMetaService,
} from "@blocksuite/affine-shared/services";
import type { BlockModel } from "@blocksuite/store";
import { signal } from "@preact/signals-core";
import { html, type TemplateResult } from "lit";
import { literal } from "lit/static-html.js";
import { shellIconPaths } from "../../../app/ShellIcon";

let titles = new Map<string, string>();

/** Replaces the known "not shared" titles (from the native catalog). */
export function setUnsharedTitles(entries: { id: string; title: string }[]) {
  titles = new Map(
    entries.map((entry) => [entry.id, entry.title || "Untitled notebook"]),
  );
}
export const unsharedTitle = (id: string) => titles.get(id);

function notebookIcon(className = "shell-icon") {
  return html`<svg
    class=${className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d=${shellIconPaths.notebook} />
  </svg>`;
}

/** Titles and icons for references whose notebook isn't in this workspace. */
class KnotDocDisplayMetaService extends DocDisplayMetaService {
  override title(pageId: string, options: { title?: string } = {}) {
    const shared = !this.std.collection.getDoc(pageId) && unsharedTitle(pageId);
    return shared
      ? signal(options.title || shared)
      : super.title(pageId, options);
  }
  override icon(
    pageId: string,
    options: Parameters<DocDisplayMetaService["icon"]>[1] = {},
  ) {
    if (!this.std.collection.getDoc(pageId) && unsharedTitle(pageId))
      return signal(notebookIcon("knot-unshared-inline-icon"));
    return super.icon(pageId, options);
  }
}

type SyncedView = HTMLElement & {
  model: BlockModel & { pageId: string };
  doc: { deleteBlock(model: BlockModel): void; readonly: boolean };
  blockState: { isDeleted: boolean };
  renderBlock(): unknown;
  renderGfxBlock?(): unknown;
  renderEmbed(content: () => TemplateResult): TemplateResult;
};

function placeholder(view: SyncedView) {
  const title = unsharedTitle(view.model.pageId) ?? "Untitled notebook";
  return html`<section
    class="knot-unshared-card"
    aria-label=${`${title}, not shared`}
  >
    ${notebookIcon()}
    <span class="knot-unshared-text">
      <strong title=${title}>${title}</strong>
      <small>Not shared</small>
    </span>
    ${
      view.doc.readonly
        ? null
        : html`<button
            type="button"
            aria-label="Remove card"
            title="Remove card"
            @pointerdown=${(event: PointerEvent) => event.stopPropagation()}
            @click=${(event: MouseEvent) => {
              event.stopPropagation();
              view.doc.deleteBlock(view.model);
            }}
          >
            <svg
              class="shell-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d=${shellIconPaths.close} />
            </svg>
          </button>`
    }
  </section>`;
}
const isUnshared = (view: SyncedView) =>
  view.blockState.isDeleted && !!unsharedTitle(view.model.pageId);

export const UnsharedSpec: ExtensionType = {
  setup(di) {
    di.override(DocDisplayMetaProvider, KnotDocDisplayMetaService, [
      StdIdentifier,
    ]);
    di.override(
      BlockViewIdentifier("affine:embed-synced-doc"),
      () => (model: BlockModel) =>
        model.parent?.flavour === "affine:surface"
          ? literal`knot-canvas-synced-doc`
          : literal`knot-page-synced-doc`,
    );
  },
};

/** Subclasses of BlockSuite's synced-doc blocks that show the placeholder. */
export function registerUnsharedPlacements() {
  const page = customElements.get("affine-embed-synced-doc-block") as
    (new () => SyncedView) | undefined;
  const canvas = customElements.get(
    "affine-embed-edgeless-synced-doc-block",
  ) as (new () => SyncedView) | undefined;
  if (page && !customElements.get("knot-page-synced-doc")) {
    class PageSyncedDoc extends page {
      override renderBlock() {
        return isUnshared(this)
          ? this.renderEmbed(() => placeholder(this))
          : super.renderBlock();
      }
    }
    customElements.define("knot-page-synced-doc", PageSyncedDoc);
  }
  if (canvas && !customElements.get("knot-canvas-synced-doc")) {
    // Canvas blocks render through renderGfxBlock, which bypasses renderBlock.
    class CanvasSyncedDoc extends canvas {
      override renderGfxBlock() {
        return isUnshared(this) ? placeholder(this) : super.renderGfxBlock!();
      }
    }
    customElements.define("knot-canvas-synced-doc", CanvasSyncedDoc);
  }
}
