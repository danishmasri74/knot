import {
  BlockComponent,
  BlockService,
  BlockViewExtension,
  FlavourExtension,
} from "@blocksuite/block-std";
import type { NoteBlockModel } from "@blocksuite/blocks";
import { defineBlockSchema, type SchemaToModel } from "@blocksuite/store";
import { html, nothing, type TemplateResult } from "lit";
import { until } from "lit/directives/until.js";
import { literal } from "lit/static-html.js";
import { shellIconPaths } from "../../../app/ShellIcon";
import {
  cardEmbedFlavour,
  cardPreview,
  mcqReferenceFlavour,
  nodeMcq,
  type CardNode,
  type DeckCard,
  type DeckData,
} from "./card-deck";
import { mcqDecks } from "./mcq-block";

// A Card Deck note card shown inside another note (docs/STORAGE.md). The
// note stores only the card ID; the content comes from the deck, so edits
// anywhere show here. It is read here and edited through "Edit card".

export const CardEmbedSchema = defineBlockSchema({
  flavour: cardEmbedFlavour,
  props: () => ({ cardId: "" }),
  metadata: {
    version: 1,
    role: "content",
    parent: ["affine:note"],
    children: [],
  },
});
type CardEmbedModel = SchemaToModel<typeof CardEmbedSchema>;

export interface CardEditRequest {
  cardId: string;
}

type Run = { insert?: unknown; attributes?: Record<string, unknown> };
const prop = (node: CardNode, key: string) => {
  const value = node.props[key];
  return value?.type === "json" ? value.value : undefined;
};

// Images are read once per session from the workspace's attachments.
const images = new Map<string, Promise<string>>();
function imageUrl(component: BlockComponent, key: string) {
  let job = images.get(key);
  if (!job) {
    job = component.doc.blobSync.get(key).then((blob) => {
      if (!blob) throw Error("missing");
      return URL.createObjectURL(blob);
    });
    job.catch(() => images.delete(key));
    images.set(key, job);
  }
  return job;
}

function runs(delta: Run[]) {
  return delta.map((run) => {
    if (typeof run.insert !== "string") return nothing;
    const marks = run.attributes ?? {};
    let content: TemplateResult | string = run.insert;
    if (marks.code) content = html`<code>${content}</code>`;
    if (marks.bold) content = html`<strong>${content}</strong>`;
    if (marks.italic) content = html`<em>${content}</em>`;
    if (marks.strike) content = html`<s>${content}</s>`;
    if (marks.underline) content = html`<u>${content}</u>`;
    if (typeof marks.link === "string")
      content = html`<a href=${marks.link} target="_blank" rel="noreferrer"
        >${content}</a
      >`;
    return content;
  });
}

function renderNodes(
  component: BlockComponent,
  nodes: CardNode[],
  deck: DeckData,
): TemplateResult[] {
  const out: TemplateResult[] = [];
  let ordinal = 0;
  for (const node of nodes) {
    const flavour = String(prop(node, "sys:flavour") ?? "");
    const type = String(prop(node, "prop:type") ?? "");
    const text = node.props["prop:text"];
    const delta = text?.type === "text" ? (text.delta as Run[]) : [];
    ordinal = flavour === "affine:list" && type === "numbered" ? ordinal + 1 : 0;
    const children = node.children.length
      ? html`<div class="card-embed-children">
          ${renderNodes(component, node.children, deck)}
        </div>`
      : nothing;
    if (flavour === "affine:paragraph") {
      const content = delta.length ? runs(delta) : html`<br />`;
      out.push(
        /^h[1-6]$/.test(type)
          ? html`<div class="card-embed-heading" data-level=${type}>
              ${content}
            </div>`
          : type === "quote"
            ? html`<blockquote>${content}</blockquote>`
            : html`<p>${content}</p>`,
        );
    } else if (flavour === "affine:list") {
      const marker = ordinal
        ? `${ordinal}.`
        : type === "todo"
          ? prop(node, "prop:checked")
            ? "☑"
            : "☐"
          : "•";
      out.push(
        html`<div class="card-embed-list">
          <span aria-hidden="true">${marker}</span><span>${runs(delta)}</span>
        </div>`,
      );
    } else if (flavour === "affine:code")
      out.push(html`<pre><code>${runs(delta)}</code></pre>`);
    else if (flavour === "affine:divider") out.push(html`<hr />`);
    else if (flavour === "affine:image") {
      const key = String(prop(node, "prop:sourceId") ?? "");
      const caption = String(prop(node, "prop:caption") ?? "");
      if (key)
        out.push(
          html`<figure>
            ${until(
              imageUrl(component, key).then(
                (src) => html`<img src=${src} alt=${caption} />`,
                () => html`<span class="card-embed-missing">Image unavailable</span>`,
              ),
              html`<span class="card-embed-loading"></span>`,
            )}
            ${caption ? html`<figcaption>${caption}</figcaption>` : nothing}
          </figure>`,
        );
    } else if (flavour === mcqReferenceFlavour || flavour === "knot:mcq") {
      const quiz = nodeMcq(node, deck);
      out.push(
        html`<p class="card-embed-object">
          ${quiz?.question ?? "Multiple-choice question unavailable"}
        </p>`,
      );
    } else if (flavour === cardEmbedFlavour) {
      // One level only: a card shown in a card is named, not expanded.
      const inner = deck[String(prop(node, "prop:cardId") ?? "")];
      out.push(
        html`<p class="card-embed-object">
          ${inner && !inner.deleted
            ? cardPreview(inner, "Empty card", deck).split("\n")[0]
            : "Card unavailable"}
        </p>`,
      );
    } else {
      // Videos, links and files: their name, opening their address.
      const url = String(prop(node, "prop:url") ?? "");
      const label =
        String(prop(node, "prop:title") ?? "") ||
        String(prop(node, "prop:name") ?? "") ||
        url;
      if (label)
        out.push(
          html`<p class="card-embed-object">
            ${url
              ? html`<a href=${url} target="_blank" rel="noreferrer">${label}</a>`
              : label}
          </p>`,
        );
    }
    if (children !== nothing) out.push(children);
  }
  return out;
}

class CardEmbedService extends BlockService {
  static override readonly flavour = cardEmbedFlavour;
}

const icon = (path: string) =>
  html`<svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    aria-hidden="true"
  >
    <path d=${path}></path>
  </svg>`;

class CardEmbedBlock extends BlockComponent<CardEmbedModel> {
  private stopDeck?: () => void;
  private shown?: DeckCard;

  override connectedCallback() {
    super.connectedCallback();
    this.contentEditable = "false";
    const deck = mcqDecks.get(this.doc.spaceDoc);
    this.shown = deck?.data[this.model.cardId];
    this.stopDeck = deck?.subscribe(() => {
      const next = deck.data[this.model.cardId];
      if (next === this.shown && next?.deleted === this.shownDeleted) return;
      this.shown = next;
      this.requestUpdate();
      void this.updateComplete.then(() =>
        this.closest("affine-edgeless-note")?.dispatchEvent(
          new Event("knot-note-preview", { bubbles: true }),
        ),
      );
    });
    this.shownDeleted = this.shown?.deleted;
  }
  private shownDeleted?: boolean;

  override disconnectedCallback() {
    this.stopDeck?.();
    super.disconnectedCallback();
  }

  override renderBlock() {
    const deck = mcqDecks.get(this.doc.spaceDoc);
    const card = deck?.data[this.model.cardId];
    this.shownDeleted = card?.deleted;
    const parent = this.doc.getParent(this.model) as NoteBlockModel | null;
    const editable = !this.doc.readonly && !parent?.isLocked?.();
    const remove = () => {
      this.doc.captureSync();
      this.doc.deleteBlock(this.model);
      this.doc.captureSync();
    };
    const stop = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("button, a"))
        event.stopPropagation();
    };
    const actions = editable
      ? html`<div class="card-embed-actions">
          ${card && !card.deleted
            ? html`<button
                type="button"
                class="card-embed-action"
                @click=${() =>
                  window.dispatchEvent(
                    new CustomEvent<CardEditRequest>("knot-edit-card", {
                      detail: { cardId: this.model.cardId },
                    }),
                  )}
              >
                Edit card
              </button>`
            : nothing}
          ${card?.deleted && !card.purged
            ? html`<button
                type="button"
                class="card-embed-action"
                @click=${() => deck?.restore(this.model.cardId)}
              >
                Restore card
              </button>`
            : nothing}
          <button
            type="button"
            class="card-embed-action"
            aria-label="Remove card from note"
            data-tooltip="Remove card from note"
            @click=${remove}
          >
            ${icon(shellIconPaths.close)}
          </button>
        </div>`
      : nothing;
    const body =
      !deck || !card || card.deleted
        ? html`<p class="card-embed-missing">
            ${card?.deleted ? "This card is in Trash." : "Card unavailable."}
          </p>`
        : html`<div class="card-embed-body">
            ${renderNodes(this, card.nodes, deck.data)}
          </div>`;
    return html`<section
      class="knot-card-embed"
      aria-label="Card from Card Deck"
      @pointerdown=${stop}
      @mousedown=${stop}
      @click=${stop}
    >
      <header>
        <span class="card-embed-label">
          ${icon(shellIconPaths.cardDeck)} Card Deck
        </span>
        ${actions}
      </header>
      ${body}
    </section>`;
  }
}

if (!customElements.get("knot-card-embed"))
  customElements.define("knot-card-embed", CardEmbedBlock);

export const CardEmbedSpec = [
  FlavourExtension(cardEmbedFlavour),
  CardEmbedService,
  BlockViewExtension(cardEmbedFlavour, literal`knot-card-embed`),
];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace BlockSuite {
    interface BlockModels {
      "knot:card-embed": CardEmbedModel;
    }
  }
}
