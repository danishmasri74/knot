export type WebLink =
  | { kind: "web"; url: string }
  | { kind: "reserved" }
  | { kind: "blocked" }
  | { kind: "other" };

/** Classification does not open anything or interpret internal note references. */
export function classifyWebLink(value: string): WebLink {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host === "knot.invalid" || host.endsWith(".knot.invalid"))
      return { kind: "reserved" };
    if (
      ["javascript:", "data:", "file:", "tauri:", "asset:", "ipc:"].includes(
        url.protocol,
      )
    )
      return { kind: "blocked" };
    if (!["http:", "https:"].includes(url.protocol)) return { kind: "other" };
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      (["127.0.0.1", "[::1]"].includes(host) && url.port === "1420") ||
      url.username ||
      url.password ||
      value.length > 8192
    )
      return { kind: "blocked" };
    return { kind: "web", url: url.href };
  } catch {
    return { kind: "other" };
  }
}

export function normalizeWebAddress(value: string): string {
  let input = value.trim();
  if (!input || /\s/.test(input))
    throw new Error("Enter a web address, such as example.com.");
  if (
    !/^[a-z][a-z\d+.-]*:/i.test(input) ||
    /^[^/:]+\.\w+:\d+(\/|$)/.test(input)
  )
    input = `https://${input}`;
  const result = classifyWebLink(input);
  if (result.kind !== "web")
    throw new Error(
      "Enter an HTTP or HTTPS address. Local app addresses are unavailable.",
    );
  // A bare word is not a search query or a public hostname.
  const host = new URL(result.url).hostname;
  if (!host.includes(".") && !host.startsWith("["))
    throw new Error("Enter a complete hostname, such as example.com.");
  return result.url;
}

const preferenceKey = "knot.web-links";
export type LinkPreference = "knot" | "external";
let sessionPreference: LinkPreference | undefined;
export function getLinkPreference(): LinkPreference {
  if (sessionPreference) return sessionPreference;
  try {
    return localStorage.getItem(preferenceKey) === "external"
      ? "external"
      : "knot";
  } catch {
    return "knot";
  }
}
export function setLinkPreference(value: LinkPreference) {
  sessionPreference = value;
  try {
    localStorage.setItem(preferenceKey, value);
  } catch {
    /* Session UI still works. */
  }
}

/** BlockSuite invokes window.open only from its actual Open action. Keep its
 * text-selection/link-editing gestures and attachment blob opens untouched. */
export function installWebLinkRouter(
  route: (url: string, reserved: boolean) => void,
) {
  const original = window.open;
  const open: typeof window.open = (value, target, features) => {
    const href = value?.toString() ?? "";
    const result = classifyWebLink(href);
    if (result.kind === "blocked") return null;
    if (result.kind === "other")
      return original.call(window, value, target, features);
    route(
      result.kind === "web" ? result.url : href,
      result.kind === "reserved",
    );
    return null;
  };
  window.open = open;
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) return;
    const anchor = event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
      );
    if (!anchor || anchor.hasAttribute("download")) return;
    const result = classifyWebLink(anchor.href);
    if (result.kind === "other") return;
    event.preventDefault();
    if (result.kind === "blocked") return;
    route(
      result.kind === "web" ? result.url : anchor.href,
      result.kind === "reserved",
    );
  };
  document.addEventListener("click", click);
  document.addEventListener("auxclick", click);
  return () => {
    if (window.open === open) window.open = original;
    document.removeEventListener("click", click);
    document.removeEventListener("auxclick", click);
  };
}
