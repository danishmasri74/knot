import {
  BlockComponent,
  BlockService,
  BlockViewExtension,
  FlavourExtension,
} from "@blocksuite/block-std";
import type { Doc, BlockModel } from "@blocksuite/store";
import {
  mcqReferenceFlavour,
  resolveDeckMcq,
  unavailableMcq,
  type CardDeck,
} from "./card-deck";
import type { NoteBlockModel } from "@blocksuite/blocks";
import {
  ExcerptHtmlAdapter,
  ExcerptTextAdapter,
} from "./cited-excerpt-adapters";
import { defineBlockSchema, type SchemaToModel } from "@blocksuite/store";
import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { literal } from "lit/static-html.js";
import type * as Y from "yjs";
import { shellIconPaths } from "../../../app/ShellIcon";
import { readMcq, type McqDefinition, type McqProgress } from "../../quiz/mcq";

export const McqSchema = defineBlockSchema({
  flavour: "knot:mcq",
  props: () => ({ definition: null as McqDefinition | null }),
  metadata: {
    version: 1,
    role: "content",
    parent: ["affine:note"],
    children: [],
  },
});
type McqModel = SchemaToModel<typeof McqSchema>;

export const McqReferenceSchema = defineBlockSchema({
  flavour: mcqReferenceFlavour,
  props: () => ({ cardId: "" }),
  metadata: {
    version: 1,
    role: "content",
    parent: ["affine:note"],
    children: [],
  },
});
type McqReferenceModel = SchemaToModel<typeof McqReferenceSchema>;

export const mcqDecks = new WeakMap<Y.Doc, CardDeck>();

export function resolveMcqBlock(doc: Doc, model: BlockModel | undefined) {
  if (model?.flavour === mcqReferenceFlavour) {
    const reference = model as McqReferenceModel;
    const deck = mcqDecks.get(doc.spaceDoc);
    if (deck) return resolveDeckMcq(deck.data, reference.cardId);
  }
  if (model?.flavour === "knot:mcq")
    return readMcq((model as McqModel).definition);
}

export interface McqEditRequest {
  doc: Y.Doc;
  cardId: string;
}

export interface McqContext extends EventTarget {
  ready: boolean;
  exporting: boolean;
  error: string;
  progress: Map<string, McqProgress>;
  busy: Set<string>;
  load(): Promise<void>;
  answer(
    cardId: string,
    quiz: McqDefinition,
    option: string | null,
    submit: boolean,
  ): Promise<void>;
}

export const mcqContexts = new WeakMap<Y.Doc, McqContext>();

class McqService extends BlockService {
  static override readonly flavour = "knot:mcq";
}

class McqReferenceService extends BlockService {
  static override readonly flavour = mcqReferenceFlavour;
}

class McqBlock extends BlockComponent<McqModel | McqReferenceModel> {
  private stopDeck?: () => void;
  private context?: McqContext;
  private pending = false;
  private error = "";
  private gradingRevision?: string;
  private retry?: () => Promise<void>;

  private refresh = () => {
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.closest("affine-edgeless-note")?.dispatchEvent(
        new Event("knot-note-preview", { bubbles: true }),
      );
    });
  };

  override connectedCallback() {
    super.connectedCallback();
    this.contentEditable = "false";
    this.std.clipboard.registerAdapter("text/html", ExcerptHtmlAdapter, 90);
    this.std.clipboard.registerAdapter("text/plain", ExcerptTextAdapter, 70);
    if (this.model.flavour === mcqReferenceFlavour) {
      const deck = mcqDecks.get(this.doc.spaceDoc);
      const id = (this.model as McqReferenceModel).cardId;
      let definition = deck && resolveDeckMcq(deck.data, id);
      let deleted = deck?.data[id]?.deleted;
      this.stopDeck = deck?.subscribe(() => {
        const next = resolveDeckMcq(deck.data, id);
        const tombstone = deck.data[id]?.deleted;
        if (next === definition && tombstone === deleted) return;
        definition = next;
        deleted = tombstone;
        this.refresh();
      });
    }
    this.context = mcqContexts.get(this.doc.spaceDoc);
    this.context?.addEventListener("change", this.refresh);
    void this.context?.load();
  }

  override disconnectedCallback() {
    this.stopDeck?.();
    this.context?.removeEventListener("change", this.refresh);
    super.disconnectedCallback();
  }

  private async perform(task: () => Promise<void>) {
    if (this.pending) return;
    this.pending = true;
    this.error = "";
    this.requestUpdate();
    try {
      await task();
      this.retry = undefined;
    } catch (error) {
      this.error = String(error);
      this.retry = task;
    } finally {
      this.pending = false;
      this.requestUpdate();
    }
  }

  override renderBlock() {
    const quiz = resolveMcqBlock(this.doc, this.model);
    if (quiz?.gradingRevision !== this.gradingRevision) {
      this.gradingRevision = quiz?.gradingRevision;
      this.error = "";
      this.retry = undefined;
    }
    const parent = this.doc.getParent(this.model);
    const reference =
      this.model.flavour === mcqReferenceFlavour
        ? (this.model as McqReferenceModel)
        : undefined;
    const deck = mcqDecks.get(this.doc.spaceDoc);
    const cardId = reference
      ? reference.cardId
      : parent &&
        this.doc.spaceDoc.getMap<string>("knot:card-links").get(parent.id);
    const context = this.context;
    const exporting = context?.exporting;
    const editable =
      !exporting &&
      !this.doc.readonly &&
      !(parent as NoteBlockModel | undefined)?.isLocked();
    const removeReference = () => {
      this.doc.captureSync();
      this.doc.deleteBlock(this.model);
      this.doc.captureSync();
    };
    if (!quiz)
      return html`<section class="knot-mcq mcq-unavailable">
        <p>${unavailableMcq}.</p>
        ${
          reference && editable
            ? html`<footer
                @pointerdown=${(event: Event) => event.stopPropagation()}
              >
                ${
                  deck?.data[reference.cardId]?.deleted
                    ? html`<button
                        type="button"
                        class="mcq-quiet-action"
                        @click=${() => deck.restore(reference.cardId)}
                      >
                        Restore question
                      </button>`
                    : nothing
                }
                <button
                  type="button"
                  class="mcq-quiet-action"
                  @click=${removeReference}
                >
                  Remove reference
                </button>
              </footer>`
            : nothing
        }
      </section>`;
    const interactive = !!(
      cardId &&
      context &&
      !exporting &&
      !this.doc.readonly
    );
    const previous = interactive ? context.progress.get(cardId) : undefined;
    const progress =
      previous?.revision === quiz.gradingRevision ? previous : undefined;
    const answered = progress?.correct != null;
    const selected = progress?.optionId;
    const correctIndex = quiz.options.findIndex(
      ({ id }) => id === quiz.correctOptionId,
    );
    const questionId = `mcq-question-${this.instanceId}`;
    const disabled =
      !interactive ||
      !context?.ready ||
      context.busy.has(cardId) ||
      this.pending ||
      !!this.retry;
    const update = (option: string | null, submit = false) => {
      if (cardId && context && !disabled)
        void this.perform(() => context.answer(cardId, quiz, option, submit));
    };
    const stop = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input, label, button")
      )
        event.stopPropagation();
    };
    return html` <section
      class="knot-mcq ${reference ? "mcq-embedded" : ""}"
      aria-label="Multiple choice"
      @keydown=${stop}
      @pointerdown=${stop}
      @mousedown=${stop}
      @click=${stop}
    >
      <header>
        <p class="mcq-question" id=${questionId}>${quiz.question}</p>
        ${
          interactive && editable
            ? html`<div class="mcq-player-actions">
                <button
                  type="button"
                  data-mcq-control
                  class="mcq-quiet-action"
                  @click=${() =>
                    window.dispatchEvent(
                      new CustomEvent<McqEditRequest>("knot-edit-mcq", {
                        detail: { cardId, doc: this.doc.spaceDoc },
                      }),
                    )}
                >
                  Edit question
                </button>
                ${
                  reference
                    ? html`<button
                        type="button"
                        data-mcq-control
                        class="mcq-quiet-action"
                        aria-label="Remove question from note"
                        data-tooltip="Remove question from note"
                        @click=${removeReference}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                          aria-hidden="true"
                        >
                          <path d=${shellIconPaths.close}></path>
                        </svg>
                      </button>`
                    : nothing
                }
              </div>`
            : nothing
        }
      </header>
      <fieldset
        aria-labelledby=${questionId}
        ?disabled=${answered || !interactive || !context?.ready}
      >
        ${quiz.options.map(
          ({ id, text }, index) =>
            html` <label class="mcq-choice">
              ${
                exporting
                  ? nothing
                  : html`<input
                      data-mcq-control
                      type="radio"
                      name=${`mcq-${this.model.id}-${this.instanceId}`}
                      .checked=${live(id === selected)}
                      @change=${(event: Event) => {
                        if (disabled)
                          (event.currentTarget as HTMLInputElement).checked =
                            id === selected;
                        else update(id);
                      }}
                    />`
              }
              <span class="mcq-choice-text">${"ABCD"[index]}. ${text}</span>
            </label>`,
        )}
      </fieldset>
      <div aria-live="polite">
        ${
          answered
            ? html`<div
                class="mcq-feedback"
                data-correct=${String(progress.correct)}
              >
                <strong class="mcq-result">
                  <svg
                    class="mcq-result-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d=${shellIconPaths.circle}></path>
                    <path
                      d=${progress.correct ? "M8 12l3 3 5-6" : "M9 9l6 6m0-6l-6 6"}
                    ></path>
                  </svg>
                  ${progress.correct ? "Correct" : "Incorrect"}
                </strong>
                <p class="mcq-explanation">
                  The correct answer is
                  <b
                    >${"ABCD"[correctIndex]}.
                    ${quiz.options[correctIndex].text}.</b
                  >
                  <span class="mcq-explanation-copy">${quiz.explanation}</span>
                </p>
              </div>`
            : previous && previous.revision !== quiz.gradingRevision
              ? html`<p>Question updated. Answer again.</p>`
              : nothing
        }
      </div>
      ${
        interactive && context?.error
          ? html`<p role="alert">${context.error}</p>
              <button type="button" @click=${() => void context.load()}>
                Retry loading
              </button>`
          : nothing
      }
      ${
        interactive && this.error
          ? html`<p role="alert">Could not save your answer. ${this.error}</p>
              <button
                type="button"
                ?disabled=${this.pending}
                @click=${() => this.retry && void this.perform(this.retry)}
              >
                Retry save
              </button>`
          : nothing
      }
      ${
        interactive
          ? html`<footer>
              ${
                answered
                  ? html`<button
                      data-mcq-control
                      type="button"
                      class="mcq-quiet-action"
                      ?disabled=${disabled}
                      @click=${() => update(null)}
                    >
                      Try again
                    </button>`
                  : html`<button
                      data-mcq-control
                      type="button"
                      class="mcq-check-action"
                      ?disabled=${disabled || !selected}
                      @click=${() => selected && update(selected, true)}
                    >
                      Check answer
                    </button>`
              }
            </footer>`
          : nothing
      }
    </section>`;
  }

  private readonly instanceId = crypto.randomUUID();
}

if (!customElements.get("knot-mcq"))
  customElements.define("knot-mcq", McqBlock);
class McqReferenceBlock extends McqBlock {}
if (!customElements.get("knot-mcq-reference"))
  customElements.define("knot-mcq-reference", McqReferenceBlock);
export const McqSpec = [
  FlavourExtension(mcqReferenceFlavour),
  McqReferenceService,
  BlockViewExtension(mcqReferenceFlavour, literal`knot-mcq-reference`),
  FlavourExtension("knot:mcq"),
  McqService,
  BlockViewExtension("knot:mcq", literal`knot-mcq`),
];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace BlockSuite {
    interface BlockModels {
      "knot:mcq": McqModel;
      "knot:mcq-reference": McqReferenceModel;
    }
  }
}
