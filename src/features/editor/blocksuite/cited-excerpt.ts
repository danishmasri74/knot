import {
  ExcerptHtmlAdapter,
  ExcerptTextAdapter,
} from "./cited-excerpt-adapters";
import {
  FlavourExtension,
  BlockComponent,
  BlockViewExtension,
  BlockService,
} from "@blocksuite/block-std";
import {
  defineBlockSchema,
  Text,
  type SchemaToModel,
  type Doc,
} from "@blocksuite/store";
import { html } from "lit";
import { literal } from "lit/static-html.js";
import {
  parsePdfSourceUrl,
  pdfSourceLabel,
  type PdfLocation,
} from "./pdf-highlights";

export const CitedExcerptSchema = defineBlockSchema({
  flavour: "knot:cited-excerpt",
  props: (internal) => ({
    text: internal.Text(),
    source: "",
    reviewed: false,
  }),
  metadata: {
    version: 1,
    role: "content",
    parent: ["affine:note"],
    children: [],
  },
});
export type CitedExcerptModel = SchemaToModel<typeof CitedExcerptSchema>;

export function unlinkExcerpt(doc: Doc, model: CitedExcerptModel) {
  const parent = doc.getParent(model);
  if (!parent) throw new Error("This excerpt is no longer available.");
  const text = model.text.toString();
  const source = model.source;
  const reviewed = model.reviewed;
  let paragraphId = "";
  doc.captureSync();
  doc.transact(() => {
    paragraphId = doc.addBlock(
      "affine:paragraph",
      { type: "quote", text: new Text(text) },
      parent,
      parent.children.indexOf(model),
    );
    doc.deleteBlock(model);
  });
  doc.captureSync();
  return () => {
    const paragraph = doc.getBlock(paragraphId)?.model;
    if (
      !paragraph ||
      paragraph.children.length ||
      paragraph.flavour !== "affine:paragraph" ||
      (paragraph as unknown as { text: Text }).text.toString() !== text
    )
      throw new Error(
        "The editable excerpt has changed. Use document Undo to restore earlier changes.",
      );
    const currentParent = doc.getParent(paragraph);
    if (!currentParent) throw new Error("The excerpt has moved.");
    doc.captureSync();
    doc.transact(() => {
      doc.addBlock(
        "knot:cited-excerpt",
        { text: new Text(text), source, reviewed },
        currentParent,
        currentParent.children.indexOf(paragraph),
      );
      doc.deleteBlock(paragraph);
    });
    doc.captureSync();
  };
}

// Only combine an adjacent quote and a dedicated source paragraph. Keep mixed
// content intact and available for manual review.
export function migrateCitedExcerpts(doc: Doc) {
  for (const { model: note } of doc.getBlocksByFlavour("affine:note")) {
    const children = [...note.children];
    for (let index = 1; index < children.length; index++) {
      const quote = children[index - 1] as unknown as {
        id: string;
        flavour: string;
        type?: string;
        text?: Text;
        children: unknown[];
      };
      const link = children[index] as unknown as {
        id: string;
        flavour: string;
        text?: Text;
        children: unknown[];
      };
      if (
        quote.flavour !== "affine:paragraph" ||
        quote.type !== "quote" ||
        !quote.text ||
        quote.children.length ||
        link.flavour !== "affine:paragraph" ||
        link.children.length
      )
        continue;
      const delta = link.text?.toDelta();
      const href = delta?.[0]?.attributes?.link;
      if (
        typeof href !== "string" ||
        !href.startsWith("https://knot.invalid/pdf") ||
        !delta?.every((part) => part.attributes?.link === href)
      )
        continue;
      try {
        const location = parsePdfSourceUrl(href);
        if (!location?.rects.length) continue;
        doc.transact(() => {
          doc.addBlock(
            "knot:cited-excerpt",
            {
              text: new Text(quote.text!.toString()),
              source: href,
              reviewed: false,
            },
            note,
            note.children.findIndex((child) => child.id === quote.id),
          );
          doc.deleteBlock(doc.getBlock(quote.id)!.model);
          doc.deleteBlock(doc.getBlock(link.id)!.model);
        });
      } catch {
        /* Preserve malformed legacy citations for manual repair. */
      }
    }
  }
}

class CitedExcerptService extends BlockService {
  static override readonly flavour = "knot:cited-excerpt";
}
class CitedExcerptBlock extends BlockComponent<CitedExcerptModel> {
  private sourceText = "";
  private error = "";
  private checking = false;
  override connectedCallback() {
    super.connectedCallback();
    this.contentEditable = "false";
    this.std.clipboard.registerAdapter("text/html", ExcerptHtmlAdapter, 90);
    this.std.clipboard.registerAdapter("text/plain", ExcerptTextAdapter, 70);
  }
  private async checkSource() {
    this.checking = true;
    this.error = "";
    this.requestUpdate();
    try {
      const source = parsePdfSourceUrl(this.model.source);
      if (!source) throw new Error("The PDF reference is invalid.");
      const { readPdfExcerpt } = await import("./read-pdf-excerpt");
      this.sourceText = await readPdfExcerpt(source);
      if (
        this.sourceText.replace(/\s+/g, " ").trim() ===
        this.model.text.toString().replace(/\s+/g, " ").trim()
      ) {
        this.doc.captureSync();
        this.doc.updateBlock(this.model, { reviewed: true });
        this.doc.captureSync();
      }
    } catch (error) {
      this.error = String(error);
    } finally {
      this.checking = false;
      this.requestUpdate();
    }
  }
  override renderBlock() {
    let location: PdfLocation | null = null;
    try {
      location = parsePdfSourceUrl(this.model.source);
    } catch {
      /* Render the retained quote even when a source is unavailable. */
    }
    return html`<div
      class="knot-cited-excerpt"
      contenteditable="false"
      @copy=${(event: ClipboardEvent) => {
        const selection = window.getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          this.contains(selection.anchorNode) &&
          this.contains(selection.focusNode)
        ) {
          event.clipboardData?.setData("text/plain", selection.toString());
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <blockquote
        tabindex="0"
        aria-label="Read-only cited excerpt"
        .textContent=${this.model.text.toString()}
      ></blockquote>
      <div class="knot-excerpt-source">
        <a href=${this.model.source}
          >${location ? pdfSourceLabel(location) : "Unavailable PDF source"}</a
        >
        <button
          class="knot-excerpt-unlink"
          title="Convert to editable text and remove citation"
          aria-label="Convert excerpt to editable text"
          ?disabled=${this.doc.readonly}
          @click=${() => unlinkExcerpt(this.doc, this.model)}
        >
          Unlink
        </button>
      </div>
      ${
        !this.model.reviewed
          ? html`<div class="knot-excerpt-review">
              <span>Existing excerpt · source review needed</span>
              <button
                ?disabled=${this.checking || this.doc.readonly}
                @click=${() => this.checkSource()}
              >
                ${this.checking ? "Checking…" : "Check source"}
              </button>
              ${
                this.sourceText
                  ? html`<p>Text found at this location</p>
                      <blockquote>${this.sourceText}</blockquote>
                      <button
                        ?disabled=${this.doc.readonly}
                        @click=${() => {
                          this.doc.captureSync();
                          this.doc.updateBlock(this.model, {
                            text: new Text(this.sourceText),
                            reviewed: true,
                          });
                          this.doc.captureSync();
                        }}
                      >
                        Use source excerpt
                      </button>
                      <button
                        ?disabled=${this.doc.readonly}
                        @click=${() => unlinkExcerpt(this.doc, this.model)}
                      >
                        Keep as editable text
                      </button>`
                  : ""
              }
            </div>`
          : ""
      }
      ${this.error ? html`<p role="alert">${this.error}</p>` : ""}
    </div>`;
  }
}
if (!customElements.get("knot-cited-excerpt"))
  customElements.define("knot-cited-excerpt", CitedExcerptBlock);
export const CitedExcerptSpec = [
  FlavourExtension("knot:cited-excerpt"),
  CitedExcerptService,
  BlockViewExtension("knot:cited-excerpt", literal`knot-cited-excerpt`),
];

declare global {
  // BlockSuite discovers custom model types through its global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace BlockSuite {
    interface BlockModels {
      "knot:cited-excerpt": CitedExcerptModel;
    }
  }
}
