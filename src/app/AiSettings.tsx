import { AiDiagnostics } from "./AiDiagnostics";
import { useEffect, useId, useRef, useState } from "react";
import { ShellIcon } from "./ShellIcon";
import { OcrSettings } from "./OcrSettings";
import {
  getAiSuggestionsEnabled,
  setAiSuggestionsEnabled,
  AI_MODELS,
  AI_CONNECTOR_SHAPES,
  getAiConnectorShape,
  setAiConnectorShape,
  type AiConnectorShape,
  getWorkspaceSearchEnabled,
  setWorkspaceSearchEnabled,
  getAiAbilities,
  setAiAbilities,
  getWebSearchEnabled,
  setWebSearchEnabled,
  getAiModels,
  setAiModels,
  setAiEnabled,
} from "../services/ai-preferences";

export function AiSettings({
  enabled,
  beforeReload,
}: {
  enabled: boolean;
  beforeReload: () => Promise<void>;
}) {
  const [workspaceSearch, setWorkspaceSearch] = useState(
    getWorkspaceSearchEnabled,
  );
  const [suggestions, setSuggestions] = useState(getAiSuggestionsEnabled);
  const [abilities, setAbilities] = useState(getAiAbilities);
  const [webSearch, setWebSearch] = useState(getWebSearchEnabled);
  const [confirm, setConfirm] = useState(false);
  const [models, setModels] = useState(getAiModels);
  const [connectorShape, setConnectorShape] = useState(getAiConnectorShape);
  const [saveError, setSaveError] = useState("");
  return (
    <section className="settings-page settings-ai">
      <h3>AI</h3>
      <p className="settings-description">
        Make room for a little help with your notes.
      </p>
      <div className="settings-group">
      <div className="settings-row">
        <div>
          <strong id="ai-enabled-label">AI features</strong>
          <p>
            Show Ask Knot and AI tools. Changing this setting reloads the app.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-enabled-label"
          aria-checked={enabled}
          onClick={() => setConfirm(true)}
        >
          <span />
        </button>
      </div>
      <div className="settings-row">
        <div>
          <strong id="ai-suggestions-label">AI suggestions</strong>
          <p>
            Suggest useful questions and actions when you open Ask Knot, and
            next steps under answers that suit one. Uses text from your current
            note and the answer with your connected AI provider.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-suggestions-label"
          aria-checked={suggestions}
          disabled={!enabled}
          onClick={() => {
            try {
              setAiSuggestionsEnabled(!suggestions);
              setSuggestions(!suggestions);
              setSaveError("");
            } catch {
              setSaveError("Could not save AI suggestions preference.");
            }
          }}
        >
          <span />
        </button>
      </div>
      <div className="settings-row ai-connector-setting">
        <div>
          <strong id="ai-connector-shape-label">Default connector shape</strong>
          <p id="ai-connector-shape-description">
            Shape of arrows between cards created by AI. Applies to new arrows
            on this device.
          </p>
        </div>
        <div
          className="ai-connector-choices"
          role="radiogroup"
          aria-labelledby="ai-connector-shape-label"
          aria-describedby="ai-connector-shape-description"
        >
          {AI_CONNECTOR_SHAPES.map((shape) => (
            <label key={shape} className="ai-connector-choice">
              <input
                type="radio"
                name="ai-connector-shape"
                value={shape}
                checked={connectorShape === shape}
                onChange={() => {
                  try {
                    setAiConnectorShape(shape);
                    setConnectorShape(shape);
                    setSaveError("");
                  } catch {
                    setSaveError(
                      "Could not save connector shape. Please try again.",
                    );
                  }
                }}
              />
              <ConnectorShapePreview shape={shape} />
              <span className="ai-connector-choice-label">
                <span>{shape[0].toUpperCase() + shape.slice(1)}</span>
                {connectorShape === shape && <ShellIcon name="check" />}
              </span>
            </label>
          ))}
        </div>
      </div>
      </div>
      <h3 className="settings-section-title">Abilities</h3>
      <p className="settings-description">
        What Ask Knot can do on its own when you send a message. You review
        every change before it is applied.
      </p>
      <h4 className="settings-group-title">Finding information</h4>
      <div className="settings-group">
      <div className="settings-row">
        <div>
          <strong id="ai-workspace-search-label">Search my workspace</strong>
          <p>
            Let Knot search your other notes when a question needs them. Search
            runs on this device; only the excerpts it finds are sent to your
            configured AI provider.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-workspace-search-label"
          aria-checked={workspaceSearch}
          disabled={!enabled}
          onClick={() => {
            try {
              setWorkspaceSearchEnabled(!workspaceSearch);
              setWorkspaceSearch(!workspaceSearch);
              setSaveError("");
            } catch {
              setSaveError("Could not save workspace search preference.");
            }
          }}
        >
          <span />
        </button>
      </div>
      <OcrSettings enabled={enabled && workspaceSearch} />
      <div className="settings-row">
        <div>
          <strong id="ai-web-search-label">Search the web</strong>
          <p>
            Let Knot search the web when a question needs current or outside
            information. Searches go through OpenAI and cost about $0.01 each,
            shown in the answer&apos;s cost. To show the matching passage for
            each cited link, Knot then opens the cited pages from this
            computer, at no extra cost.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-web-search-label"
          aria-checked={webSearch}
          disabled={!enabled}
          onClick={() => {
            try {
              setWebSearchEnabled(!webSearch);
              setWebSearch(!webSearch);
              setSaveError("");
            } catch {
              setSaveError("Could not save web search preference.");
            }
          }}
        >
          <span />
        </button>
      </div>
      <div className="settings-row">
        <div>
          <strong id="ai-view-images-label">Look at images in my notes</strong>
          <p>
            Let Knot look at up to three images from the open note or canvas
            when a question is about them. Images you attach are always read.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-view-images-label"
          aria-checked={abilities.viewImages}
          disabled={!enabled}
          onClick={() => {
            const next = { ...abilities, viewImages: !abilities.viewImages };
            try {
              setAiAbilities(next);
              setAbilities(next);
              setSaveError("");
            } catch {
              setSaveError("Could not save AI abilities.");
            }
          }}
        >
          <span />
        </button>
      </div>
      </div>
      <h4 className="settings-group-title">Suggesting changes</h4>
      <div className="settings-group">
      <div className="settings-row">
        <div>
          <strong id="ai-edit-note-label">Edit the current note</strong>
          <p>
            Suggest rewrites of selected text and additions to the open note.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-edit-note-label"
          aria-checked={abilities.editNote}
          disabled={!enabled}
          onClick={() => {
            const next = { ...abilities, editNote: !abilities.editNote };
            try {
              setAiAbilities(next);
              setAbilities(next);
              setSaveError("");
            } catch {
              setSaveError("Could not save AI abilities.");
            }
          }}
        >
          <span />
        </button>
      </div>
      <div className="settings-row">
        <div>
          <strong id="ai-canvas-cards-label">Create cards on canvas</strong>
          <p>Suggest cards, arrows and mind maps for the open canvas.</p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-canvas-cards-label"
          aria-checked={abilities.canvasCards}
          disabled={!enabled}
          onClick={() => {
            const next = { ...abilities, canvasCards: !abilities.canvasCards };
            try {
              setAiAbilities(next);
              setAbilities(next);
              setSaveError("");
            } catch {
              setSaveError("Could not save AI abilities.");
            }
          }}
        >
          <span />
        </button>
      </div>
      <div className="settings-row">
        <div>
          <strong id="ai-create-notes-label">Create new notes</strong>
          <p>
            Suggest a whole new note in the open notebook when you ask for
            one. You review it before it is added.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-create-notes-label"
          aria-checked={abilities.createNotes}
          disabled={!enabled}
          onClick={() => {
            const next = { ...abilities, createNotes: !abilities.createNotes };
            try {
              setAiAbilities(next);
              setAbilities(next);
              setSaveError("");
            } catch {
              setSaveError("Could not save AI abilities.");
            }
          }}
        >
          <span />
        </button>
      </div>
      <div className="settings-row">
        <div>
          <strong id="ai-quizzes-label">Make quizzes</strong>
          <p>
            Suggest a card of multiple-choice questions beside the open note,
            with an arrow from it, when you ask for a quiz. You review them
            before they are added.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="ai-quizzes-label"
          aria-checked={abilities.quizzes}
          disabled={!enabled}
          onClick={() => {
            const next = { ...abilities, quizzes: !abilities.quizzes };
            try {
              setAiAbilities(next);
              setAbilities(next);
              setSaveError("");
            } catch {
              setSaveError("Could not save AI abilities.");
            }
          }}
        >
          <span />
        </button>
      </div>
      </div>
      <h3 className="settings-section-title">Model list</h3>
      <p id="ai-models-description" className="settings-description">
        Choose which models appear in Ask Knot on this device. Keep at least one
        enabled.
      </p>
      <div
        className="settings-group ai-model-list"
        role="group"
        aria-label="AI models"
        aria-describedby="ai-models-description"
      >
        {AI_MODELS.map((model) => {
          const checked = models.includes(model.id);
          const last = checked && models.length === 1;
          return (
            <div className="settings-row ai-model-row" key={model.id}>
              <div>
                <strong id={`model-${model.id}`}>
                  {model.name} <span className="ai-model-tag">{model.tag}</span>
                </strong>
                <p>OpenAI &middot; {model.description}</p>
              </div>
              <button
                className="settings-toggle"
                role="switch"
                aria-labelledby={`model-${model.id}`}
                aria-checked={checked}
                disabled={last}
                title={
                  last ? "At least one model must stay enabled" : undefined
                }
                onClick={() => {
                  const next = checked
                    ? models.filter((id) => id !== model.id)
                    : [...models, model.id];
                  try {
                    setAiModels(next);
                    setModels(next);
                    setSaveError("");
                  } catch {
                    setSaveError(
                      "Could not save model preferences. Please try again.",
                    );
                  }
                }}
              >
                <span />
              </button>
            </div>
          );
        })}
      </div>
      <p className="ai-model-note">
        Model access depends on your OpenAI API account. Manage your connection
        in Ask Knot. Model choices are kept when AI is turned off.
      </p>
      <AiDiagnostics />
      {saveError && <p role="alert">{saveError}</p>}
      {confirm && (
        <AiReloadConfirmation
          enabled={!enabled}
          onClose={() => setConfirm(false)}
          beforeReload={beforeReload}
        />
      )}
    </section>
  );
}

function ConnectorShapePreview({ shape }: { shape: AiConnectorShape }) {
  const arrowId = useId();
  const path = {
    curve: "M22 18 C74 18 54 54 106 54",
    elbowed: "M22 18 H64 V54 H106",
    straight: "M22 18 L106 54",
  }[shape];
  return (
    <svg
      className="ai-connector-preview"
      viewBox="0 0 128 72"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <marker
          id={arrowId}
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path
            d="M1 1 L5 3 L1 5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <g stroke="currentColor" strokeWidth="1.5" opacity="0.5">
        <rect x="4" y="9" width="18" height="18" rx="3" />
        <rect x="106" y="45" width="18" height="18" rx="3" />
      </g>
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={`url(#${arrowId})`}
      />
    </svg>
  );
}

function AiReloadConfirmation({
  enabled,
  onClose,
  beforeReload,
}: {
  enabled: boolean;
  onClose: () => void;
  beforeReload: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="trash-confirmation"
      aria-labelledby="ai-reload-title"
      aria-describedby="ai-reload-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="confirmation-icon">
        <ShellIcon name="sparkles" />
      </div>
      <h2 id="ai-reload-title">
        {enabled ? "Enable" : "Disable"} AI features?
      </h2>
      <p id="ai-reload-description">
        Knot will save your notes and reload to {enabled ? "show" : "hide"} Ask
        Knot and AI tools. Your saved chats and connection settings will be
        kept.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="trash-actions">
        <button ref={cancel} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await beforeReload();
              setAiEnabled(enabled);
              window.location.reload();
            } catch (cause) {
              setError(`Could not apply the change. ${String(cause)}`);
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Apply & reload"}
        </button>
      </div>
    </dialog>
  );
}
