import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ShellIcon } from "./ShellIcon";
import { browserApi } from "../services/browser";
import {
  autoCheckEnabled,
  checkForUpdate,
  downloadUpdate,
  formatBytes,
  installedNotes,
  lastCheckedAt,
  relativeTime,
  setAutoCheckEnabled,
  skipUpdate,
  useUpdateState,
} from "../services/updater";

const RELEASES = "https://github.com/knot-desktop/knot-releases/releases";

/** Settings → Updates: one status line, one action, then notes and options. */
export function UpdatesSettings({
  busy,
  onInstall,
}: {
  busy: boolean;
  onInstall: () => void;
}) {
  const update = useUpdateState();
  const [current, setCurrent] = useState("");
  const [auto, setAuto] = useState(autoCheckEnabled);
  const [skipped, setSkipped] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    void getVersion().then(setCurrent);
    // Keep "Checked 4 minutes ago" honest while the page stays open.
    const timer = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const checkedAt =
    update.kind === "current" ? update.checkedAt : lastCheckedAt();
  const checked = checkedAt
    ? `Checked ${relativeTime(checkedAt)}`
    : "Not checked yet";
  let title = current ? `Knot ${current} is up to date` : "Knot is up to date";
  let detail = checked;
  let tone: "normal" | "error" = "normal";
  let notes: string[] = [];
  let notesVersion = "";
  let progress: { value: number; max?: number } | null = null;
  let primary: { label: string; run: () => void } | null = null;
  let secondary: { label: string; run: () => void; disabled?: boolean } | null =
    {
      label: "Check for updates",
      run: () => void checkForUpdate({ manual: true }),
    };

  switch (update.kind) {
    case "idle":
      if (!checkedAt) title = current ? `Knot ${current}` : "Knot";
      break;
    case "checking":
      title = "Checking for updates…";
      detail = "Asking GitHub for the newest version";
      secondary = { label: "Check for updates", run: () => {}, disabled: true };
      break;
    case "available":
      title = skipped
        ? `Knot ${update.version} skipped`
        : `Knot ${update.version} is available`;
      detail = skipped
        ? "You'll hear about the next version. You can still download this one."
        : `You have ${current}`;
      notes = update.notes;
      notesVersion = update.version;
      primary = { label: "Download update", run: () => void downloadUpdate() };
      secondary = skipped
        ? null
        : {
            label: "Skip this version",
            run: () => {
              skipUpdate(update.version);
              setSkipped(true);
            },
          };
      break;
    case "downloading":
      title = `Downloading ${update.version}`;
      detail = update.total
        ? `${formatBytes(update.downloaded)} of ${formatBytes(update.total)} · You can keep working`
        : `${formatBytes(update.downloaded)} · You can keep working`;
      progress = { value: update.downloaded, max: update.total };
      notes = update.notes;
      notesVersion = update.version;
      secondary = null;
      break;
    case "ready":
      title = `Knot ${update.version} is ready to install`;
      detail = "Knot saves your work, makes a backup, then restarts";
      notes = update.notes;
      notesVersion = update.version;
      primary = { label: "Restart to update", run: onInstall };
      secondary = null;
      break;
    case "preparing":
      title =
        update.step === "saving" ? "Saving your work…" : "Creating a backup…";
      detail = `Getting ready to install ${update.version}`;
      secondary = { label: "Restart to update", run: () => {}, disabled: true };
      break;
    case "failed":
      title = update.message;
      detail = current
        ? `Knot ${current} is still installed. Nothing in your workspace changed.`
        : "";
      tone = "error";
      notes = update.notes ?? [];
      notesVersion = update.version ?? "";
      secondary = {
        label: "Try again",
        run: () =>
          void (update.retry === "check"
            ? checkForUpdate({ manual: true })
            : update.retry === "download"
              ? downloadUpdate()
              : onInstall()),
      };
      break;
  }
  if (!notes.length && current && update.kind !== "failed") {
    const installed = installedNotes(current);
    if (installed.length) {
      notes = installed;
      notesVersion = current;
    }
  }
  const working = busy || update.kind === "preparing";

  return (
    <section className="settings-page settings-updates">
      <h3>Updates</h3>
      <p className="settings-description">
        Keep Knot current. Your notes stay on this device.
      </p>

      <div className="settings-identity updates-status" aria-live="polite">
        <img className="brand-mark updates-mark" src="/knot-mark.svg" alt="" />
        <div>
          <strong className={tone === "error" ? "updates-error" : undefined}>
            {title}
          </strong>
          {detail && <small>{detail}</small>}
          {progress && (
            <div
              className="updates-progress"
              role="progressbar"
              aria-label={title}
              aria-valuemin={0}
              aria-valuemax={progress.max}
              aria-valuenow={progress.value}
            >
              <span
                style={{
                  width: progress.max
                    ? `${Math.min(100, (progress.value / progress.max) * 100)}%`
                    : "100%",
                }}
              />
            </div>
          )}
        </div>
        {primary && (
          <button
            className="updates-primary"
            disabled={working}
            onClick={primary.run}
          >
            {primary.label}
          </button>
        )}
        {secondary && (
          <button
            disabled={working || secondary.disabled}
            onClick={secondary.run}
          >
            {secondary.label}
          </button>
        )}
      </div>

      {notes.length > 0 && (
        <div className="updates-notes">
          <strong>What's new in {notesVersion}</strong>
          <ul>
            {notes.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          {update.kind === "ready" && (
            <p>
              Before installing, Knot saves your work and makes a backup in
              Settings → Backups.
            </p>
          )}
        </div>
      )}

      <h3 className="settings-section-title">Preferences</h3>
      <div className="settings-group">
      <div className="settings-row">
        <div>
          <strong id="updates-auto-label">
            Check for updates automatically
          </strong>
          <p>
            Knot asks GitHub for the newest version once a day. No notes or
            personal data are sent.
          </p>
        </div>
        <button
          className="settings-toggle"
          role="switch"
          aria-labelledby="updates-auto-label"
          aria-checked={auto}
          onClick={() => {
            setAutoCheckEnabled(!auto);
            setAuto(!auto);
          }}
        >
          <span />
        </button>
      </div>

      <div className="settings-row">
        <div>
          <strong>Release history</strong>
          <p>Every version and its notes, on the Knot releases page.</p>
        </div>
        <button
          onClick={() => void browserApi.external(RELEASES).catch(() => {})}
        >
          Open <ShellIcon name="external" />
        </button>
      </div>
      </div>
    </section>
  );
}
