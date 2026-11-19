import {
  readingOrder,
  sceneSummary,
  type Scene,
  type SceneObject,
  type SceneOutline,
} from "../features/editor/blocksuite/scene";
import {
  anyCitation,
  resolvePdfCitation,
  type CitedPdf,
  type PdfCitation,
} from "../services/pdf-citations";
import { PdfRef } from "./PdfPreview";

/**
 * Splits a section's description into text and links to the pages it
 * cites. A file named with its slides ("X.pptx, slides 1–5") also becomes
 * the file for later citations without a name ("(slide 3)").
 */
export function citedParts(text: string, pdfs: CitedPdf[]): (string | PdfCitation)[] {
  if (!pdfs.length) return [text];
  let file: CitedPdf | undefined;
  return text.split(anyCitation()).map((part, i) => {
    if (i % 2 === 0) return part;
    const bare = !part.startsWith("(");
    const citation = bare ? `(${part})` : part;
    const cited =
      resolvePdfCitation(citation, pdfs) ?? (file ? resolvePdfCitation(citation, [file]) : undefined);
    if (cited && bare) file = cited.pdf;
    return cited ?? part;
  });
}

const kindLabel: Record<SceneObject["kind"], string> = {
  card: "Card",
  text: "Text",
  shape: "Shape",
  frame: "Section",
  mindmap: "Mind map",
  existing: "Move",
};

/**
 * What a scene will add, before it's applied: the structure Ask Knot chose
 * (its plan), a count, and an outline of sections and what they hold.
 */
export function ScenePreview({
  scene,
  review,
  title,
}: {
  scene: Scene;
  /** The title of something already on the canvas, by its map handle. */
  title?: (handle: string) => string;
  /** The draft check before this preview, if it found anything. */
  review?: { rounds: number; summaries: string[]; before: number; after: number };
}) {
  const titleOf = (o: SceneObject) =>
    (o.kind === "existing" ? title?.(o.ref) || "a card already on the canvas" : "") ||
    o.text ||
    (o.kind === "mindmap" ? o.nodes[0]?.text : "") ||
    kindLabel[o.kind];
  const outline = (container: string, depth: number): React.ReactNode[] =>
    readingOrder(scene.objects.filter((o) => o.in === container)).flatMap((o) => [
      <li key={o.id} className="ask-scene-item" data-kind={o.kind} style={{ paddingLeft: depth * 14 }}>
        <span className="ask-scene-kind">{kindLabel[o.kind]}</span>
        <span>{titleOf(o)}</span>
      </li>,
      ...(o.kind === "frame" ? outline(o.id, depth + 1) : []),
    ]);
  return (
    <div className="ask-scene-preview">
      {scene.plan && <p className="ask-scene-plan">{scene.plan}</p>}
      <p className="ask-scene-count">Create {sceneSummary(scene)}.</p>
      {review && (
        <p className="ask-scene-review">
          {review.after === 0
            ? `Checked the draft and fixed ${review.before === 1 ? "the 1 problem" : `all ${review.before} problems`} it found.`
            : review.after < review.before
              ? `Checked the draft and fixed ${review.before - review.after} of ${review.before} problems.`
              : `Checked the draft; ${review.before} ${review.before === 1 ? "problem remains" : "problems remain"}.`}
          {review.summaries.length > 0 && ` ${review.summaries.join(" ")}`}
        </p>
      )}
      <ul className="ask-scene-outline">{outline("", 0)}</ul>
    </div>
  );
}

/**
 * A job too large for one reply: the sections Ask Knot will build, what
 * that should cost and take, and how far a build got.
 */
export function OutlinePreview({
  outline,
  estimate,
  build,
  pdfs = [],
  onPdf,
}: {
  outline: SceneOutline;
  estimate?: { usd?: number; seconds: number };
  build?: { state: string; done: number; total: number; error?: string };
  /** The files the request sent, so cited slides can open. */
  pdfs?: CitedPdf[];
  onPdf?: (pdf: CitedPdf, page: number) => void;
}) {
  const time = (s: number) =>
    s < 90 ? `${Math.max(10, Math.round(s / 10) * 10)} seconds` : `${Math.round(s / 60)} minutes`;
  return (
    <div className="ask-scene-preview">
      {outline.plan && <p className="ask-scene-plan">{outline.plan}</p>}
      <p className="ask-scene-count">
        Too large for one reply, so Ask Knot builds it in {outline.sections.length} sections, then
        connects them and checks the layout.
        {estimate &&
          !build &&
          ` That takes about ${time(estimate.seconds)}${
            estimate.usd !== undefined
              ? ` and costs about ${estimate.usd < 0.01 ? "under US$0.01" : `US$${estimate.usd.toFixed(2)}`}`
              : ""
          }.`}
      </p>
      {build && build.state !== "done" && (
        <p className="ask-scene-review">
          {build.state === "building"
            ? `Building: ${build.done} of ${build.total} sections done.`
            : build.state === "failed"
              ? `Stopped after ${build.done} of ${build.total} sections: ${build.error ?? "a section failed"} Continue to build the rest.`
              : `Stopped after ${build.done} of ${build.total} sections. Continue to build the rest, or apply what's built.`}
        </p>
      )}
      <ol className="ask-outline-sections">
        {outline.sections.map((s) => (
          <li key={s.id}>
            <strong>{s.title}</strong>
            {s.covers && (
              <span>
                {onPdf
                  ? citedParts(s.covers, pdfs).map((part, i) =>
                      typeof part === "string" ? part : <PdfRef key={i} cited={part} onOpen={onPdf} />,
                    )
                  : s.covers}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
