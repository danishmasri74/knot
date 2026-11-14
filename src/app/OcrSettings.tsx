import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  getOcrPreferences,
  setOcrPreferences,
} from "../services/ai-preferences";

/** What the background reader reports (src-tauri/src/ocr.rs, `ocr_status`). */
type OcrStatus = {
  phase:
    | "off"
    | "unavailable"
    | "paused"
    | "battery"
    | "user-active"
    | "app-busy"
    | "limit"
    | "resting"
    | "reading"
    | "idle";
  language: string | null;
  read: number;
  unreadable: number;
  waiting: number;
  backlog: number;
};

const images = (n: number) =>
  `${n} ${n === 1 ? "image or scanned page" : "images and scanned pages"}`;

export function ocrStatusText(status: OcrStatus): string {
  const progress = `${status.read} of ${status.read + status.waiting}`;
  switch (status.phase) {
    case "off":
      return "Off";
    case "unavailable":
      return "Windows has no text recognition for your languages. Add a language with Optical character recognition in Windows Settings → Time & language → Language & region.";
    case "paused":
      return status.waiting ? `Paused · ${progress} read` : "Paused";
    case "battery":
      return status.waiting ? "Waiting: on battery" : "Up to date";
    case "user-active":
      return status.waiting ? "Waiting while you work" : "Up to date";
    case "app-busy":
      return status.waiting ? "Waiting while Knot is busy" : "Up to date";
    case "limit":
      return "Taking a break: hourly limit reached";
    case "reading":
    case "resting":
      return `Reading · ${progress}`;
    case "idle":
      return status.waiting
        ? `Reading · ${progress}`
        : status.read
          ? `Up to date · text found in ${images(status.read)}`
          : "Up to date";
  }
}

/**
 * Settings → AI → Read text in images (docs/WORKSPACE-OCR-PLAN.md).
 * Images already in the workspace wait for Read now.
 */
export function OcrSettings({ enabled }: { enabled: boolean }) {
  const [prefs, setPrefs] = useState(getOcrPreferences);
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [error, setError] = useState("");
  const active = enabled && prefs.enabled;
  useEffect(() => {
    if (!isTauri() || !active) {
      setStatus(null);
      return;
    }
    let alive = true;
    const poll = () =>
      invoke<OcrStatus>("ocr_status")
        .then((next) => alive && setStatus(next))
        .catch(() => alive && setStatus(null));
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active]);
  function update(next: Partial<typeof prefs>) {
    try {
      setOcrPreferences(next);
      setPrefs(getOcrPreferences());
      setError("");
    } catch {
      setError("Could not save the text-in-images preference.");
    }
  }
  async function readNow() {
    try {
      const { activation } = await invoke<{ activation: string }>(
        "topic_catalog",
      );
      await invoke("ocr_read_backlog", { activation });
      setStatus((s) => s && { ...s, waiting: s.waiting + s.backlog, backlog: 0 });
      setError("");
    } catch {
      setError("Could not start reading older images.");
    }
  }
  return (
    <>
      <div className="settings-row">
        <div>
          <strong id="ai-ocr-label">Read text in images and scans</strong>
          <p>
            Find words in screenshots, photos of slides and scanned PDF pages
            when Knot searches your workspace. Text is read on this device by
            Windows, one image or page at a time, only while plugged in and
            while you&apos;re not using the computer.
          </p>
          {active && status && (
            <p className="settings-ocr-status" aria-live="polite">
              {ocrStatusText(status)}
            </p>
          )}
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-ocr-label"
          aria-checked={prefs.enabled}
          disabled={!enabled}
          onClick={() => update({ enabled: !prefs.enabled })}
        >
          <span />
        </button>
      </div>
      {active && status && status.backlog > 0 && (
        <div className="settings-row">
          <div>
            <strong>Added earlier</strong>
            <p>
              {images(status.backlog)} were in this workspace before text
              reading was turned on. Read now starts reading them slowly in the
              background, at most 300 an hour.
            </p>
          </div>
          <button onClick={() => void readNow()}>Read now</button>
        </div>
      )}
      {active && status && status.phase !== "unavailable" && (
        <div className="settings-row">
          <div>
            <strong id="ai-ocr-battery-label">Also read on battery</strong>
            <p>Uses some battery. Off by default.</p>
          </div>
          <button
            className="settings-toggle"
            role="switch"
            aria-labelledby="ai-ocr-battery-label"
            aria-checked={prefs.battery}
            onClick={() => update({ battery: !prefs.battery })}
          >
            <span />
          </button>
        </div>
      )}
      {active &&
        status &&
        status.phase !== "unavailable" &&
        (status.waiting > 0 || prefs.paused) && (
          <div className="settings-row">
            <div>
              <strong>{prefs.paused ? "Reading paused" : "Pause reading"}</strong>
              <p>
                {prefs.paused
                  ? "Resumes when you choose, or when Knot restarts."
                  : "Stops until you resume or Knot restarts. Nothing read so far is lost."}
              </p>
            </div>
            <button onClick={() => update({ paused: !prefs.paused })}>
              {prefs.paused ? "Resume" : "Pause"}
            </button>
          </div>
        )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
