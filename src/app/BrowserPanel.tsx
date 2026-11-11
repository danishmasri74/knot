import { Mascot } from "./Mascot";
import { useEffect, useRef, useState } from "react";
import {
  browserApi,
  browserBounds,
  type BrowserRequest,
  type BrowserStatus,
} from "../services/browser";
import { normalizeWebAddress } from "../services/web-links";
import { ShellIcon } from "./ShellIcon";
import { listen } from "@tauri-apps/api/event";

export function BrowserPanel({
  request,
  onNavigate,
  expanded,
  onExpand,
  onClose,
}: {
  request: BrowserRequest | null;
  onNavigate: (url: string) => void;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [error, setError] = useState("");
  const [obscured, setObscured] = useState(false);
  useEffect(() => {
    const off = listen("browser-focus-address", () => {
      address.current?.focus();
      address.current?.select();
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, []);
  useEffect(() => {
    setError("");
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await browserApi.status();
        if (!alive) return;
        setStatus(next);
        if (!editing.current) setValue(next?.url ?? "");
      } catch (e) {
        if (alive) setError(String(e));
      }
      if (alive) timer = setTimeout(() => void poll(), 400);
    };
    void browserApi
      .ensure(request, browserBounds(viewport.current!))
      .then((next) => {
        if (!alive) return;
        setStatus(next);
        if (next) setValue(next.url);
        else address.current?.focus();
        void poll();
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [request]);
  useEffect(() => {
    let frame = 0;
    const element = viewport.current!;
    let previous = "";
    let alive = true;
    const place = () => {
      if (!alive) return;
      cancelAnimationFrame(frame);
      const panel = element.closest<HTMLElement>(".browser-panel")!;
      const single = String(
        (element.closest("main")?.clientWidth ?? innerWidth) <= 760,
      );
      if (panel.dataset.singlePane !== single)
        panel.dataset.singlePane = single;
      const bounds = browserBounds(element);
      const covered = [
        ...document.querySelectorAll<HTMLElement>(
          'dialog[open], .shell-menu[open], select:open, .global-search, .error-banner, .notice-banner, :popover-open, affine-link-popup, [role="menu"], [role="dialog"]',
        ),
      ].some((node) => {
        if (
          !node.getClientRects().length ||
          getComputedStyle(node).visibility === "hidden"
        )
          return false;
        if (!node.matches(".shell-tooltip")) return true;
        const tip = node.getBoundingClientRect();
        const page = element.getBoundingClientRect();
        return (
          tip.left < page.right &&
          tip.right > page.left &&
          tip.top < page.bottom &&
          tip.bottom > page.top
        );
      });
      const visible =
        !!status &&
        !document.hidden &&
        !document.documentElement.hasAttribute("data-pane-gesture") &&
        !element.closest("[hidden], [inert]") &&
        element.getClientRects().length > 0 &&
        !covered &&
        bounds.width > 2 &&
        bounds.height > 2;
      const key = JSON.stringify({ bounds, visible });
      if (key !== previous) {
        previous = key;
        setObscured(covered);
        void browserApi.bounds(bounds, visible).catch((e) => {
          if (alive) setError(String(e));
        });
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    document.addEventListener("visibilitychange", place);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", place);
      void browserApi.bounds(browserBounds(element), false).catch(() => {});
    };
  }, [status?.session]);
  const action = (kind: "back" | "forward" | "reload" | "stop" | "focus") => {
    setError("");
    void browserApi.action(kind).catch((e) => setError(String(e)));
  };
  return (
    <section className="browser-panel" aria-label="Mini browser">
      <div
        className="browser-toolbar"
        role="group"
        aria-label="Browser navigation"
      >
        <button
          aria-label="Browser back"
          disabled={!status?.back}
          onClick={() => action("back")}
        >
          <ShellIcon name="back" />
        </button>
        <button
          aria-label="Browser forward"
          disabled={!status?.forward}
          onClick={() => action("forward")}
        >
          <ShellIcon name="forward" />
        </button>
        <button
          aria-label={status?.loading ? "Stop loading page" : "Reload page"}
          disabled={!status}
          onClick={() => action(status?.loading ? "stop" : "reload")}
        >
          <ShellIcon name={status?.loading ? "close" : "refresh"} />
        </button>
        <form
          className="browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const url = normalizeWebAddress(value);
              setError("");
              editing.current = false;
              address.current?.blur();
              onNavigate(url);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          <input
            ref={address}
            type="text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            aria-label="Web address"
            placeholder="Enter a web address"
            value={value}
            title={status?.title || "Web address"}
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => {
              editing.current = false;
            }}
            onChange={(event) => setValue(event.target.value)}
          />
        </form>
        <button
          aria-label="Open in default browser"
          disabled={!status}
          onClick={() =>
            void browserApi
              .external(status!.externalUrl ?? status!.url)
              .catch((e) => setError(String(e)))
          }
        >
          <ShellIcon name="external" />
        </button>
        <button
          className="browser-expand"
          onClick={onExpand}
          aria-label={expanded ? "Restore browser split" : "Expand browser"}
        >
          <ShellIcon name="expand" />
        </button>
        <button
          className="browser-focus-page"
          aria-label="Focus webpage"
          disabled={!status}
          onClick={() => action("focus")}
        >
          <ShellIcon name="globe" />
        </button>
        <button
          data-panel-close
          aria-label="Close Browser panel"
          data-tooltip="Back to note"
          onClick={onClose}
        >
          <ShellIcon name="close" />
        </button>
        <span className="browser-status" role="status">
          {status?.loading ? "Loading…" : status?.title || "Browser"}
        </span>
      </div>
      {(error || status?.error) && (
        <div className="browser-error" role="alert">
          <span>{error || status?.error}</span>
          {status && <button onClick={() => action("reload")}>Retry</button>}
        </div>
      )}
      <div
        ref={viewport}
        className="browser-viewport"
        aria-label="Webpage area"
      >
        {!status ? (
          <div className="browser-empty">
            <Mascot mood="explore" className="browser-mascot" />
            <p>Enter a web address to begin.</p>
            <p className="browser-empty-hint">
              Browsing won’t save a source or create a note.
            </p>
          </div>
        ) : obscured ? (
          <div className="browser-empty">
            <Mascot mood="sleep" className="browser-mascot" />
            <p>The page is hidden while an app menu is open.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
