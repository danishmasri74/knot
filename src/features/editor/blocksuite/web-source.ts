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
  readDurableWebSource,
  webProvenance,
} from "../../../services/web-ai-evidence";
import { passageUrl } from "../../../services/text-fragment";
import { citedSentence } from "../../../services/cited-sentence";
import {
  ExcerptHtmlAdapter,
  ExcerptTextAdapter,
} from "./cited-excerpt-adapters";

export const WebSourceSchema = defineBlockSchema({
  flavour: "knot:web-source",
  props: (internal) => ({ text: internal.Text(), evidence: "" }),
  metadata: {
    version: 1,
    role: "content",
    parent: ["affine:note"],
    children: [],
  },
});
export type WebSourceModel = SchemaToModel<typeof WebSourceSchema>;
class WebSourceService extends BlockService {
  static override readonly flavour = "knot:web-source";
}
class WebSourceBlock extends BlockComponent<WebSourceModel> {
  override connectedCallback() {
    super.connectedCallback();
    this.contentEditable = "false";
    this.std.clipboard.registerAdapter("text/html", ExcerptHtmlAdapter, 90);
    this.std.clipboard.registerAdapter("text/plain", ExcerptTextAdapter, 70);
  }
  override renderBlock() {
    const source = readDurableWebSource(this.model.evidence);
    // The first line names the content these excerpts support.
    const supports = this.model.text
      .toString()
      .split("\n", 1)[0]
      .replace(/^Supports:\s*/, "");
    return html`<details class="knot-web-source" contenteditable="false">
      <summary>
        ${source?.sections
          .map((s) => s.citation)
          .filter(Boolean)
          .join(" ")}
        ${source?.title ?? "Retained website evidence"}
      </summary>
      <p>${this.model.text.toString()}</p>
      ${
        source
          ? html`<a href=${source.finalUrl}>Open website</a>
              <small
                >Captured
                ${new Date(Number(source.fetchedAt) || source.fetchedAt).toLocaleString()}
                · ${source.method}</small
              >
              ${source.warnings.map((w) => html`<p>${w}</p>`)}
              ${source.sections.map((s) => {
                const sentence = citedSentence(supports, s.text);
                // The quote is pre-wrap: keep its template free of whitespace.
                const text = sentence
                  ? html`${s.text.slice(0, sentence.start)}<mark>${sentence.text}</mark>${s.text.slice(sentence.end)}`
                  : s.text;
                return html`<blockquote>${s.citation} ${text}</blockquote>
                  <a
                    class="knot-web-source-passage"
                    href=${passageUrl(source.finalUrl, sentence?.text ?? s.text)}
                    >Open passage</a
                  >`;
              })}`
          : html`<p>
              Source metadata is invalid. Retained text remains available.
            </p>`
      }
    </details>`;
  }
}
if (!customElements.get("knot-web-source"))
  customElements.define("knot-web-source", WebSourceBlock);
export const WebSourceSpec = [
  FlavourExtension("knot:web-source"),
  WebSourceService,
  BlockViewExtension("knot:web-source", literal`knot-web-source`),
];
export function appendWebProvenance(
  doc: Doc,
  parent: string,
  context: string | undefined,
  refs: string[],
  supports: string,
) {
  for (const record of webProvenance(context, [...new Set(refs)])) {
    const evidence = JSON.stringify(record);
    doc.addBlock(
      "knot:web-source",
      {
        evidence,
        text: new Text(
          `Supports: ${supports}\n${record.title}\n${record.sections.map((s) => `${s.citation ?? ""} ${s.text}`).join("\n")}`,
        ),
      },
      parent,
    );
  }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace BlockSuite {
    interface BlockModels {
      "knot:web-source": WebSourceModel;
    }
  }
}
