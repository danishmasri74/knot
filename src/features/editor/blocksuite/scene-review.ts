/**
 * Look and fix (phase 2 of docs/AI-CANVAS-ORCHESTRATION-PLAN.md): before a
 * scene is previewed, Knot lays out a draft in memory, measures it and draws
 * a schematic; the model reviews that and returns changes. A round is kept
 * only when it measures better. Nothing touches the notebook until Apply.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Doc } from "@blocksuite/store";
import type { AiContext } from "./ai";
import { canvasHandles } from "../../../services/canvas-map-format";
import { mergeScene, revisionChanges, type Scene, type SceneRevision } from "./scene";
import { planScene, prepareReplacement } from "./scene-apply";
import { sceneReport, type SceneReport } from "./scene-report";
import { sceneSchematic } from "./scene-schematic";
import type { Box } from "./scene-solver";

/** Review rounds after the first draft; each one is a request. */
export const REVIEW_ROUNDS = 2;

export type ReviewResult = {
  scene: Scene;
  /** Review requests made. */
  rounds: number;
  /** What each kept round changed, in the model's words. */
  summaries: string[];
  before: SceneReport;
  after: SceneReport;
};

type Cost = { usd: number | null };

/** One review request (mode scene_review in ai.rs). */
async function requestReview(
  model: string,
  context: unknown,
  image: string,
  onCost: (cost: Cost) => void,
  signal?: AbortSignal,
): Promise<SceneRevision> {
  const id = crypto.randomUUID();
  let output = "";
  const channel = new Channel<{ delta: string; cost?: Cost }>();
  channel.onmessage = ({ delta, cost }) => {
    if (cost) onCost(cost);
    else if (output.length < 400_000) output += delta;
  };
  const stop = () => void invoke("ai_cancel", { id }).catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await invoke("ai_respond", {
      id,
      model,
      mode: "scene_review",
      messages: [{ role: "user", content: "Review the draft of your scene." }],
      context: JSON.stringify(context),
      ...(image && { image }),
      onEvent: channel,
    });
  } finally {
    signal?.removeEventListener("abort", stop);
  }
  return JSON.parse(output) as SceneRevision;
}

/** Measures a scene as it would be placed on this canvas. */
export function measureScene(
  doc: Doc,
  context: AiContext,
  scene: Scene,
  options: { view?: Box; sources?: string[]; replaces?: string },
) {
  if (options.replaces) {
    // Measured exactly as Apply places it: in the card's frame, where the card
    // was. Passages it misses are the card's, not kept-aside details.
    const prepared = prepareReplacement(doc, scene, options.replaces);
    const planned = planScene(doc, context, prepared.scene, {
      view: options.view,
      replaces: { id: prepared.replaced.note.id, box: prepared.replaced.box },
    });
    const report = sceneReport(prepared.scene, planned.boxes, planned.report, {
      view: options.view,
      handles: planned.handles,
    });
    const missing = prepared.uncovered.map((p) => (p.length > 300 ? `${p.slice(0, 299)}…` : p)).slice(0, 30);
    return {
      planned,
      report: { ...report, missing, issues: report.issues + missing.length },
      measured: prepared.scene,
    };
  }
  const planned = planScene(doc, context, scene, { view: options.view });
  const report = sceneReport(scene, planned.boxes, planned.report, {
    sources: options.sources,
    view: options.view,
    handles: planned.handles,
  });
  return { planned, report, measured: scene };
}

/**
 * A review's changes on a scene built from captured web pages: what a change
 * replaces keeps its source references (the object's, a block with the same
 * text, an arrow between the same ends), and anything new is marked as not
 * from web evidence, so every source stays traceable.
 */
export function inheritSourceRefs(before: Scene, after: Scene): Scene {
  const old = new Map(before.objects.map((o) => [o.id, o]));
  const refsOf = (o: Scene["objects"][number]) => [
    ...new Set([...(o.sourceRefs ?? []), ...o.content.flatMap((c) => c.sourceRefs ?? []), ...o.nodes.flatMap((n) => n.sourceRefs ?? [])]),
  ];
  return {
    ...after,
    objects: after.objects.map((o) => {
      const was = old.get(o.id);
      const all = was ? refsOf(was) : [];
      return {
        ...o,
        sourceRefs: o.sourceRefs ?? was?.sourceRefs ?? [],
        content: o.content.map((c) => ({
          ...c,
          sourceRefs: c.sourceRefs ?? was?.content.find((x) => x.text === c.text)?.sourceRefs ?? all,
        })),
        nodes: o.nodes.map((n) => ({
          ...n,
          sourceRefs: n.sourceRefs ?? was?.nodes.find((x) => x.text === n.text)?.sourceRefs ?? all,
        })),
      };
    }),
    connectors: after.connectors.map((c) => ({
      ...c,
      sourceRefs:
        c.sourceRefs ??
        before.connectors.find((x) => x.from === c.from && x.to === c.to)?.sourceRefs ??
        [],
    })),
  };
}

/** The scene for the review request: without Knot's own notes. */
const forReview = (scene: Scene) => ({
  plan: scene.plan,
  anchor: scene.anchor,
  objects: scene.objects,
  arrangements: scene.arrangements,
  connectors: scene.connectors,
});

export async function reviewScene(input: {
  doc: Doc;
  context: AiContext;
  scene: Scene;
  /** What the user asked for. */
  request: string;
  model: string;
  view?: Box;
  /** Source passages the scene should cover (note and card text). */
  sources?: string[];
  /** Break this into ideas: the card the scene will replace. */
  replaces?: string;
  /** Built from captured web pages: changes keep source references. */
  web?: boolean;
  onCost: (cost: Cost) => void;
  /** Called before each review request. */
  onRound?: (round: number, report: SceneReport) => void;
  signal?: AbortSignal;
  rounds?: number;
}): Promise<ReviewResult> {
  const { doc, context } = input;
  const handles = context.canvasMap ? new Set(canvasHandles(context.canvasMap).keys()) : new Set<string>();
  const existing = context.canvasMap
    ? [...canvasHandles(context.canvasMap).values()].flatMap((t) =>
        t.box ? [{ box: t.box as Box, title: t.title }] : [],
      )
    : [];
  let best = input.scene;
  let measured = measureScene(doc, context, best, input);
  const before = measured.report;
  const summaries: string[] = [];
  let rounds = 0;
  for (let round = 1; round <= (input.rounds ?? REVIEW_ROUNDS); round++) {
    if (!measured.report.issues || input.signal?.aborted) break;
    input.onRound?.(round, measured.report);
    rounds++;
    // The count is Knot's stopping rule, not something to review.
    const report: Partial<SceneReport> = { ...measured.report };
    delete report.issues;
    const image = sceneSchematic(measured.measured, measured.planned.boxes, existing);
    let revision: SceneRevision;
    try {
      revision = await requestReview(
        input.model,
        { request: input.request, scene: forReview(best), report },
        image,
        input.onCost,
        input.signal,
      );
    } catch {
      // A failed review keeps the draft as it was; the user still gets it.
      break;
    }
    if (!revisionChanges(revision)) break;
    let next: Scene;
    try {
      next = mergeScene(best, revision, handles);
      if (input.web) next = inheritSourceRefs(best, next);
    } catch {
      break;
    }
    const after = measureScene(doc, context, next, input);
    // Keep a round only when it measures better.
    if (after.report.issues >= measured.report.issues) break;
    best = next;
    measured = after;
    if (revision.summary.trim()) summaries.push(revision.summary.trim());
    if (revision.done) break;
  }
  return { scene: best, rounds, summaries, before, after: measured.report };
}
