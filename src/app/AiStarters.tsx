import { AskSuggestion } from "./AskSuggestion";
import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  AI_SUGGESTIONS_CHANGED,
  getAiSuggestionsEnabled,
  setAiSuggestionsEnabled,
} from "../services/ai-preferences";
import { parseAiSuggestions, type AiStarter } from "../services/ai-suggestions";
import type { AiContext } from "../features/editor/blocksuite/ai";
const cache = new Map<string, AiStarter[]>();
export function AiStarters({
  capture,
  model,
  eligible,
  onChoose,
}: {
  capture: () => AiContext | null;
  model: string;
  eligible: boolean;
  onChoose: (prompt: string, context: AiContext) => void;
}) {
  const [enabled, setEnabled] = useState(getAiSuggestionsEnabled);
  const [result, setResult] = useState<{
    key: string;
    context: AiContext;
    items: AiStarter[];
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const changed = () => setEnabled(getAiSuggestionsEnabled());
    window.addEventListener(AI_SUGGESTIONS_CHANGED, changed);
    return () => window.removeEventListener(AI_SUGGESTIONS_CHANGED, changed);
  }, []);
  useEffect(() => {
    if (!eligible || !enabled || !model) {
      setResult(undefined);
      return;
    }
    let stopped = false;
    let id: string | undefined;
    let last = "";
    let pendingKey = "";
    const cancel = () => {
      if (id) void invoke("ai_cancel", { id }).catch(() => {});
      id = undefined;
    };
    const tick = async () => {
      const context = capture();
      if (
        !context?.note ||
        context.pdf ||
        context.ranges.length ||
        context.text.trim().length < 40
      ) {
        cancel();
        last = "";
        setResult(undefined);
        return;
      }
      const key = JSON.stringify([
        context.workspace,
        context.document,
        context.note,
        context.version,
        model,
      ]);
      if (key !== pendingKey) {
        pendingKey = key;
        cancel();
        setResult(undefined);
        return;
      }
      if (key === last) return;
      cancel();
      last = key;
      setResult(undefined);
      const cached = cache.get(key);
      if (cached) {
        setResult({ key, context, items: cached });
        return;
      }
      const requestId = crypto.randomUUID();
      id = requestId;
      let output = "";
      const channel = new Channel<{ delta: string }>();
      channel.onmessage = ({ delta }) => {
        if (id === requestId && output.length < 5000) output += delta;
      };
      const timeout = setTimeout(() => {
        if (id === requestId) cancel();
      }, 15000);
      try {
        await invoke("ai_respond", {
          id: requestId,
          model,
          mode: "suggestions",
          messages: [
            { role: "user", content: "Suggest useful next questions." },
          ],
          context: JSON.stringify({ text: context.text.slice(0, 4000) }),
          onEvent: channel,
        });
        if (
          stopped ||
          id !== requestId ||
          capture()?.version !== context.version
        )
          return;
        const items = parseAiSuggestions(output);
        if (cache.size >= 30) cache.delete(cache.keys().next().value!);
        cache.set(key, items);
        setResult({ key, context, items });
      } catch {
        /* Basic starters remain available. */
      } finally {
        clearTimeout(timeout);
      }
    };
    const timer = setInterval(() => void tick(), 1200);
    return () => {
      stopped = true;
      clearInterval(timer);
      cancel();
    };
  }, [eligible, enabled, model, capture]);
  if (!eligible) return null;
  if (!enabled)
    return (
      <>
        <button
          onClick={() => {
            try {
              setAiSuggestionsEnabled(true);
            } catch {
              setError("Could not save preference.");
            }
          }}
        >
          Enable suggestions for this note
        </button>
        <p>Uses current note text with your AI provider. API usage applies.</p>
        {error && <p role="alert">{error}</p>}
      </>
    );
  if (!result?.items.length) return null;
  return (
    <div
      className="ask-suggestions ai-context-starters"
      role="group"
      aria-label={`Suggestions for ${result.context.label}`}
    >
      {result.items.map((item) => (
        <AskSuggestion
          label={item.label}
          key={item.label}
          onClick={() => {
            const current = capture();
            if (
              current?.instance === result.context.instance &&
              current.note === result.context.note &&
              current.version === result.context.version
            )
              onChoose(item.prompt, current);
            else setResult(undefined);
          }}
        />
      ))}
    </div>
  );
}
