import { useEffect, useMemo, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { ShellIcon } from "./ShellIcon";
import {
  MAX_FOLLOWUP_ANSWER,
  MIN_FOLLOWUP_ANSWER,
  followUpIcons,
  parseFollowUps,
  ruleFollowUps,
  type FollowUp,
  type FollowUpAction,
} from "../services/ai-followups";

/** Model suggestions already fetched this session, by answer and actions. */
const cache = new Map<string, FollowUp[]>();

/**
 * Optional next steps under the latest answer. Rules from the answer's shape
 * are free; with AI suggestions on, a small model request picks and names
 * them instead. A click only starts a request: its proposal is previewed.
 */
export function AnswerFollowUps({
  answer,
  question,
  available,
  saved,
  model,
  disabled,
  onChoose,
  onResult,
  onCost,
}: {
  answer: string;
  /** What the user asked, so buttons name the result in their words. */
  question?: string;
  available: FollowUpAction[];
  /** Suggestions stored on the answer, so reopening a chat costs nothing. */
  saved?: FollowUp[];
  /** Model for suggestions; empty uses the free rules only. */
  model: string;
  disabled: boolean;
  onChoose: (followUp: FollowUp) => void;
  onResult: (items: FollowUp[]) => void;
  onCost: (cost: unknown) => void;
}) {
  const actions = available.join(",");
  const rules = useMemo(
    () => ruleFollowUps(answer, available),
    [answer, actions],
  );
  const key = `${actions}\n${answer}`;
  const [fetched, setFetched] = useState<{ key: string; items: FollowUp[] }>();
  const [failed, setFailed] = useState("");
  const wanted =
    !saved &&
    !!model &&
    !!available.length &&
    answer.trim().length >= MIN_FOLLOWUP_ANSWER;
  useEffect(() => {
    if (!wanted || failed === key) return;
    const cached = cache.get(key);
    if (cached) {
      setFetched({ key, items: cached });
      return;
    }
    let stopped = false;
    const id = crypto.randomUUID();
    let output = "";
    const channel = new Channel<{ delta: string; cost?: unknown }>();
    channel.onmessage = ({ delta, cost }) => {
      if (cost && !stopped) onCost(cost);
      if (output.length < 5000) output += delta;
    };
    const timeout = setTimeout(
      () => void invoke("ai_cancel", { id }).catch(() => {}),
      20000,
    );
    invoke("ai_respond", {
      id,
      model,
      mode: "followups",
      messages: [{ role: "user", content: "Suggest next steps." }],
      context: JSON.stringify({
        answer: answer.slice(0, MAX_FOLLOWUP_ANSWER),
        ...(question && { question: question.slice(0, 1000) }),
        actions: available,
      }),
      onEvent: channel,
    })
      .then(() => {
        if (stopped) return;
        const items = parseFollowUps(output, available);
        if (cache.size >= 50) cache.delete(cache.keys().next().value!);
        cache.set(key, items);
        setFetched({ key, items });
        onResult(items);
      })
      .catch(() => {
        // The free rules stay available.
        if (!stopped) setFailed(key);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      stopped = true;
      clearTimeout(timeout);
      void invoke("ai_cancel", { id }).catch(() => {});
    };
  }, [wanted, key, model, failed]);
  const items =
    saved?.filter((item) => available.includes(item.action)) ??
    (!wanted || failed === key
      ? rules
      : fetched?.key === key
        ? fetched.items
        : []);
  if (!items.length) return null;
  return (
    <div className="ask-followups" role="group" aria-label="Next steps">
      {items.map((item) => (
        <button
          type="button"
          key={item.action}
          disabled={disabled}
          data-tooltip={item.focus}
          onClick={() => onChoose(item)}
        >
          <ShellIcon name={followUpIcons[item.action]} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
