import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import {
  extractTopicContent,
  extractDeckPassages,
  splitPassage,
} from "./topic-extract";
import type { TopicPassage, TopicSource } from "./topic-types";
import type { Snapshot } from "./workspace";
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.useBrowserCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = "/onnx/";
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}
let model: Promise<FeatureExtractionPipeline> | undefined;
function load() {
  const create = pipeline as unknown as (
    task: string,
    model: string,
    options: object,
  ) => Promise<FeatureExtractionPipeline>;
  model ??= create("feature-extraction", "multilingual-e5-small", {
    dtype: "q8",
    device: "wasm",
    local_files_only: true,
  });
  return model;
}
async function embed(text: string, query: boolean) {
  const pipe = await load();
  const output = await pipe(`${query ? "query" : "passage"}: ${text}`, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data as Float32Array);
}
async function refine(passages: TopicPassage[]) {
  const pipe = await load();
  const result: TopicPassage[] = [];
  for (const passage of passages) {
    const pending = [passage.text];
    while (pending.length) {
      const text = pending.shift()!;
      const tokens = await pipe.tokenizer(`passage: ${text}`);
      if (tokens.input_ids.size > 500) {
        pending.unshift(
          ...splitPassage(text, Math.max(1, Math.floor(text.length / 2))),
        );
        continue;
      }
      result.push({ ...passage, text, vector: await embed(text, false) });
    }
  }
  return result;
}
let queue = Promise.resolve();
self.onmessage = (
  event: MessageEvent<{
    id: number;
    type: string;
    query?: string;
    source?: TopicSource;
    snapshot?: Snapshot;
    card?: import("../features/editor/blocksuite/card-deck").DeckCard;
    questions?: import("../features/editor/blocksuite/card-deck").DeckData;
    passages?: TopicPassage[];
  }>,
) => {
  queue = queue.then(async () => {
    try {
      const m = event.data;
      if (m.type === "extract") {
        const { passages, pdfs } = m.card
          ? extractDeckPassages(m.source!, m.card, m.questions)
          : extractTopicContent(m.source!, m.snapshot!);
        // Keyword coverage remains available if model initialization fails.
        let semantic = true;
        let result = passages;
        try {
          result = await refine(passages);
        } catch {
          semantic = false;
        }
        self.postMessage({ id: m.id, result, semantic, pdfs });
      } else if (m.type === "passages")
        self.postMessage({ id: m.id, result: await refine(m.passages!) });
      else self.postMessage({ id: m.id, result: await embed(m.query!, true) });
    } catch {
      self.postMessage({
        id: event.data.id,
        error: "Local extraction or embedding unavailable",
      });
    }
  });
};
