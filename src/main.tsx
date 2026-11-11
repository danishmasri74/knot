import { initializeAppearance } from "./services/appearance";
import ReactDOM from "react-dom/client";
import { ShellTooltips } from "./app/ShellTooltips";
import { App } from "./app/App";
import "@toeverything/theme/style.css";
import "./styles/app.css";
import "./styles/mcq.css";
import "./styles/dropdowns.css";
// Suppress WebView's browser menu without blocking editor context-menu handlers.
document.addEventListener("contextmenu", (event) => event.preventDefault(), {
  capture: true,
});
initializeAppearance();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <ShellTooltips />
  </>,
);
