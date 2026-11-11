// One portal discovery observer for all editors. Ordinary text/selection DOM
// mutations must not cause every editor to rescan the entire notebook.
const listeners = new Map<() => void, string>();
let observer: MutationObserver | undefined;
export function observeToolbarMounts(selector: string, refresh: () => void) {
  listeners.set(refresh, selector);
  observer ??= new MutationObserver((records) => {
    for (const [listener, match] of listeners) {
      if (records.some((record) =>
        [...record.addedNodes].some((node) =>
          node instanceof Element &&
          (node.matches(match) || !!node.querySelector(match)),
        ),
      )) listener();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    listeners.delete(refresh);
    if (!listeners.size) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}
