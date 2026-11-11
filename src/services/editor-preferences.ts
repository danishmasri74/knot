export type FontStyle = "sans" | "serif" | "mono" | "custom";
export interface EditorPreferences {
  fontStyle: FontStyle;
  customFont: string;
  fontSize: number;
  spellCheck: boolean;
}
const key = "knot.editor-preferences";
const defaults: EditorPreferences = {
  fontStyle: "sans",
  customFont: "",
  fontSize: 16,
  spellCheck: true,
};
export function normalizeEditorPreferences(
  value: Partial<EditorPreferences>,
): EditorPreferences {
  return {
    fontStyle: ["sans", "serif", "mono", "custom"].includes(
      value.fontStyle ?? "",
    )
      ? value.fontStyle!
      : "sans",
    customFont:
      typeof value.customFont === "string"
        ? value.customFont.slice(0, 100)
        : "",
    fontSize:
      typeof value.fontSize === "number" && Number.isFinite(value.fontSize)
        ? Math.min(24, Math.max(12, Math.round(value.fontSize)))
        : 16,
    spellCheck: typeof value.spellCheck === "boolean" ? value.spellCheck : true,
  };
}
let preferences = defaults;
try {
  preferences = normalizeEditorPreferences(
    JSON.parse(localStorage.getItem(key) ?? "{}") ?? {},
  );
} catch {
  /* Use defaults if storage is unavailable or invalid. */
}
const listeners = new Set<() => void>();
export const getEditorPreferences = () => preferences;
export function setEditorPreferences(update: Partial<EditorPreferences>) {
  preferences = normalizeEditorPreferences({ ...preferences, ...update });
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    /* Session-only preferences. */
  }
  listeners.forEach((listener) => listener());
}
export function editorFontFamily(settings: EditorPreferences) {
  const sans = 'Inter, "Segoe UI", sans-serif';
  switch (settings.fontStyle) {
    case "serif":
      return 'Georgia, "Times New Roman", serif';
    case "mono":
      return 'Consolas, "Courier New", monospace';
    case "custom":
      return settings.customFont.trim()
        ? `${JSON.stringify(settings.customFont.trim())}, ${sans}`
        : sans;
    default:
      return sans;
  }
}
/** Presentation preferences never modify the document's stored blocks. */
export function observeEditorPreferences(editor: HTMLElement) {
  const updateElement = (element: HTMLElement) => {
    const enabled = preferences.spellCheck && !element.closest("affine-code");
    if (element.getAttribute("spellcheck") !== String(enabled))
      element.spellcheck = enabled;
  };
  const updateTree = (root: Element) => {
    if (root instanceof HTMLElement && root.matches('[contenteditable="true"]'))
      updateElement(root);
    root.querySelectorAll<HTMLElement>('[contenteditable="true"]').forEach(updateElement);
  };
  const applySpellCheck = () => {
    if (editor.getAttribute("spellcheck") !== String(preferences.spellCheck))
      editor.spellcheck = preferences.spellCheck;
    updateTree(editor);
  };
  const apply = () => {
    editor.style.setProperty(
      "--affine-font-family",
      editorFontFamily(preferences),
    );
    editor.style.setProperty("--affine-font-base", `${preferences.fontSize}px`);
    applySpellCheck();
  };
  apply();
  listeners.add(apply);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLElement) {
        if (record.target.matches('[contenteditable="true"]')) updateElement(record.target);
      } else {
        for (const node of record.addedNodes)
          if (node instanceof Element) updateTree(node);
      }
    }
  });
  observer.observe(editor, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["contenteditable", "spellcheck"],
  });
  return () => {
    observer.disconnect();
    listeners.delete(apply);
  };
}
