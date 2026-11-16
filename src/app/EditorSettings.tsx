import { useState } from "react";
import {
  BLANK_CARD_CLEANUP_DAYS,
  editorFontFamily,
  getEditorPreferences,
  setEditorPreferences,
  type EditorPreferences,
  type FontStyle,
} from "../services/editor-preferences";
export function EditorSettings() {
  const [settings, setSettings] = useState(getEditorPreferences);
  const update = (value: Partial<EditorPreferences>) => {
    setEditorPreferences(value);
    setSettings(getEditorPreferences());
  };
  return (
    <section className="settings-page editor-settings">
      <h3>Editor</h3>
      <p className="settings-description">
        Make your notes comfortable to read and write. Preferences apply to all
        notes on this device.
      </p>
      <div className="settings-row">
        <div>
          <strong id="font-style-label">Font style</strong>
          <p>Choose the typeface for your notes.</p>
        </div>
        <div
          className="appearance-switch"
          role="group"
          aria-labelledby="font-style-label"
        >
          {(["sans", "serif", "mono", "custom"] as FontStyle[]).map((style) => (
            <button
              key={style}
              style={{
                fontFamily: editorFontFamily({ ...settings, fontStyle: style }),
              }}
              aria-pressed={settings.fontStyle === style}
              onClick={() => update({ fontStyle: style })}
            >
              {style[0].toUpperCase() + style.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {settings.fontStyle === "custom" && (
        <div className="settings-row">
          <div>
            <label htmlFor="custom-font">
              <strong>Custom font family</strong>
            </label>
            <p>
              Enter a font installed on your device. Unavailable fonts use Sans.
            </p>
          </div>
          <div className="editor-font-input">
            <input
              id="custom-font"
              list="editor-fonts"
              placeholder="e.g. Segoe UI"
              maxLength={100}
              value={settings.customFont}
              onChange={(event) => update({ customFont: event.target.value })}
            />
            <datalist id="editor-fonts">
              {[
                "Arial",
                "Calibri",
                "Cambria",
                "Consolas",
                "Georgia",
                "Segoe UI",
                "Times New Roman",
                "Verdana",
              ].map((font) => (
                <option key={font} value={font} />
              ))}
            </datalist>
          </div>
        </div>
      )}
      <div className="settings-row">
        <div>
          <label htmlFor="editor-font-size">
            <strong>Font size</strong>
          </label>
          <p>Adjust the base text size for better readability.</p>
        </div>
        <div className="editor-size-control">
          <input
            id="editor-font-size"
            type="range"
            min="12"
            max="24"
            step="1"
            value={settings.fontSize}
            onChange={(event) =>
              update({ fontSize: Number(event.target.value) })
            }
          />
          <output htmlFor="editor-font-size">{settings.fontSize}px</output>
        </div>
      </div>
      <div
        className="editor-font-preview"
        style={{
          fontFamily: editorFontFamily(settings),
          fontSize: settings.fontSize,
        }}
      >
        <span>The space for your next idea.</span>
        <p>A small thought today, something worth keeping tomorrow.</p>
      </div>
      <div className="settings-row">
        <div>
          <strong id="spell-check-label">Automatic spell check</strong>
          <p>Underline possible spelling mistakes as you type.</p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="spell-check-label"
          aria-checked={settings.spellCheck}
          onClick={() => update({ spellCheck: !settings.spellCheck })}
        >
          <span />
        </button>
      </div>
      <h3 className="settings-section-title">Card Deck</h3>
      <div className="settings-row">
        <div>
          <strong id="blank-card-cleanup-label">Delete unused blank cards</strong>
          <p>
            Permanently delete empty cards that aren't on any canvas. They
            skip Trash and can't be restored.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="blank-card-cleanup-label"
          aria-checked={settings.blankCardCleanup}
          onClick={() => update({ blankCardCleanup: !settings.blankCardCleanup })}
        >
          <span />
        </button>
      </div>
      {settings.blankCardCleanup && (
        <div className="settings-row">
          <div>
            <label htmlFor="blank-card-cleanup-days">
              <strong>Clear every</strong>
            </label>
            <p>
              Also how long a blank card must go unchanged, so one you just
              made is never deleted.
            </p>
          </div>
          <div className="editor-size-control">
            <input
              id="blank-card-cleanup-days"
              type="range"
              min="0"
              max={BLANK_CARD_CLEANUP_DAYS.length - 1}
              step="1"
              value={Math.max(
                0,
                BLANK_CARD_CLEANUP_DAYS.indexOf(
                  settings.blankCardCleanupDays as (typeof BLANK_CARD_CLEANUP_DAYS)[number],
                ),
              )}
              aria-valuetext={cleanupLabel(settings.blankCardCleanupDays)}
              onChange={(event) =>
                update({
                  blankCardCleanupDays: BLANK_CARD_CLEANUP_DAYS[Number(event.target.value)],
                })
              }
            />
            <output htmlFor="blank-card-cleanup-days">
              {cleanupLabel(settings.blankCardCleanupDays)}
            </output>
          </div>
        </div>
      )}
    </section>
  );
}
function cleanupLabel(days: number) {
  return days === 1 ? "1 day" : days === 7 ? "1 week" : days === 14 ? "2 weeks" : days === 30 ? "1 month" : `${days} days`;
}
