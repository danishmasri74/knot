/**
 * Big jobs in steps (phase 3 of docs/AI-CANVAS-ORCHESTRATION-PLAN.md): an
 * outlined scene is built one section at a time, each with the request's
 * own sources, then a connecting step adds arrows between sections and
 * arranges them. Built sections are kept, so a stopped or failed build can
 * continue where it left off.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  assembleSections,
  mergeScene,
  revisionChanges,
  type Scene,
  type SceneOutline,
  type SceneRevision,
  type SceneSection,
} from "./scene";

type Cost = { usd: number | null };
export type BuildFiles = {
  pdfInput?: string;
  pdfFiles?: { name: string; data: string }[];
};

async function request(
  payload: Record<string, unknown>,
  onCost: (cost: Cost) => void,
  signal?: AbortSignal,
  /** The reply so far, as it streams in. */
  onText?: (text: string) => void,
): Promise<string> {
  const id = crypto.randomUUID();
  let output = "";
  const channel = new Channel<{ delta: string; cost?: Cost }>();
  channel.onmessage = ({ delta, cost }) => {
    if (cost) onCost(cost);
    else if (output.length < 2_000_000) {
      output += delta;
      onText?.(output);
    }
  };
  const stop = () => void invoke("ai_cancel", { id }).catch(() => {});
  if (signal?.aborted) throw new Error("Stopped");
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await invoke("ai_respond", { id, ...payload, onEvent: channel });
  } finally {
    signal?.removeEventListener("abort", stop);
  }
  return output;
}

/** Objects a streaming scene reply has begun so far (each has a kind). */
export function objectsSoFar(text: string): number {
  return text.match(/"kind"\s*:/g)?.length ?? 0;
}

/** What the model is told about the section it builds. */
export function sectionMessage(outline: SceneOutline, section: SceneSection): string {
  const all = outline.sections
    .map((s, i) => `${i + 1}. ${s.title} (id ${s.id}): ${s.covers}`)
    .join("\n");
  return `Build section "${section.title}" (id ${section.id}). It covers: ${section.covers || section.title}.\n\nThe whole outline, for context:\n${all}`;
}

/**
 * Builds the outline's sections that aren't built yet, in order. Each built
 * section's reply is stored in `built` as soon as it arrives; a failure or
 * Stop ends the build with what's done.
 */
export async function buildSections(input: {
  outline: SceneOutline;
  built: Record<string, unknown>;
  model: string;
  /** The conversation that asked for the scene, ending with the request. */
  messages: { role: string; content: string }[];
  context: string;
  files: BuildFiles;
  onSection: (index: number, total: number, section: SceneSection) => void;
  onBuilt: (section: SceneSection) => void;
  /** How many objects the section being built has so far, as it streams. */
  onProgress?: (section: SceneSection, objects: number) => void;
  onCost: (cost: Cost) => void;
  signal?: AbortSignal;
}): Promise<{ complete: boolean; error?: string }> {
  const { outline, built } = input;
  const total = outline.sections.length;
  for (const [i, section] of outline.sections.entries()) {
    if (section.id in built) continue;
    if (input.signal?.aborted) return { complete: false };
    input.onSection(i + 1, total, section);
    let shown = 0;
    try {
      const output = await request(
        {
          model: input.model,
          mode: "scene_section",
          messages: [...input.messages, { role: "user", content: sectionMessage(outline, section) }],
          context: input.context,
          ...(input.files.pdfInput && { pdfInput: input.files.pdfInput }),
          ...(input.files.pdfFiles?.length && { pdfFiles: input.files.pdfFiles }),
        },
        input.onCost,
        input.signal,
        (text) => {
          const objects = objectsSoFar(text);
          if (objects !== shown) input.onProgress?.(section, (shown = objects));
        },
      );
      const value = JSON.parse(output) as { objects?: unknown[] };
      if (!Array.isArray(value.objects) || !value.objects.length)
        throw new Error(`Section “${section.title}” came back empty.`);
      built[section.id] = value;
      input.onBuilt(section);
    } catch (error) {
      if (input.signal?.aborted) return { complete: false };
      return {
        complete: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { complete: true };
}

/**
 * Adds the arrows between built sections and arranges them, in one request.
 * The scene is returned unchanged if the step fails or adds nothing.
 */
export async function connectSections(input: {
  scene: Scene;
  outline: SceneOutline;
  request: string;
  model: string;
  handles: Set<string>;
  onCost: (cost: Cost) => void;
  signal?: AbortSignal;
}): Promise<{ scene: Scene; summary: string }> {
  const { scene } = input;
  try {
    const output = await request(
      {
        model: input.model,
        mode: "scene_connect",
        messages: [{ role: "user", content: "Connect and arrange the sections." }],
        context: JSON.stringify({
          request: input.request,
          outline: input.outline.sections,
          scene: {
            plan: scene.plan,
            anchor: scene.anchor,
            objects: scene.objects,
            arrangements: scene.arrangements,
            connectors: scene.connectors,
          },
        }),
      },
      input.onCost,
      input.signal,
    );
    const revision = JSON.parse(output) as SceneRevision;
    if (!revisionChanges(revision)) return { scene, summary: "" };
    // Only frames may be moved here; content stays as each section built it.
    const frames = new Set(scene.objects.filter((o) => o.kind === "frame").map((o) => o.id));
    const allowed: SceneRevision = {
      ...revision,
      objects: (Array.isArray(revision.objects) ? revision.objects : []).filter((o) =>
        frames.has(String((o as { id?: unknown })?.id ?? "")),
      ),
      remove: [],
      arrangements: [],
      removeArrangements: [],
      removeConnectors: [],
    };
    return { scene: mergeScene(scene, allowed, input.handles), summary: revision.summary.trim() };
  } catch {
    return { scene, summary: "" };
  }
}

/** The scene so far, from the sections built. */
export function sceneSoFar(outline: SceneOutline, built: Record<string, unknown>, handles: Set<string>) {
  return assembleSections(outline, built, handles);
}
