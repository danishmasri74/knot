import { startUiPreferences } from "./services/ui-preferences";
import "@toeverything/theme/style.css";
import "./styles/app.css";
import "./styles/sidebar.css";
import "./styles/mcq.css";
import "./styles/dropdowns.css";
import "./styles/canvas-fonts.css";
// Suppress WebView's browser menu without blocking editor context-menu handlers.
document.addEventListener("contextmenu", (event) => event.preventDefault(), {
  capture: true,
});
// Preferences must be restored before the app's modules read them, so those
// modules load only afterwards.
void (async () => {
  // The canvas measures text once per font; have its local fonts ready
  // first (canvas-fonts.css), so labels and shapes measure correctly.
  const canvasFonts = Promise.all(
    ["300", "400", "600"].map((weight) =>
      document.fonts.load(`${weight} 16px "blocksuite:surface:Inter"`),
    ),
  ).catch(() => {});
  await startUiPreferences();
  await canvasFonts;
  const [{ initializeAppearance }, { default: ReactDOM }, { ShellTooltips }, { App }] =
    await Promise.all([
      import("./services/appearance"),
      import("react-dom/client"),
      import("./app/ShellTooltips"),
      import("./app/App"),
    ]);
  initializeAppearance();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <>
      <App />
      <ShellTooltips />
    </>,
  );
})();
