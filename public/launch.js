// Apply the saved appearance before the first paint and before editor imports.
try {
  var launchAppearance = localStorage.getItem("knot.appearance");
  document.documentElement.dataset.theme =
    launchAppearance === "dark" || launchAppearance === "light"
      ? launchAppearance
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
} catch {
  document.documentElement.dataset.theme = matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches
    ? "dark"
    : "light";
}
