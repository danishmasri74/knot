/** Finish the single document-launch splash once workspace startup has settled. */
export function dismissLaunchSplash() {
  const splash = document.getElementById("launch-splash");
  if (!splash || splash.dataset.dismissing) return;
  splash.dataset.dismissing = "true";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animations = splash.getAnimations({ subtree: true });
  void Promise.allSettled(
    animations.map((animation) => animation.finished),
  ).then(async () => {
    // Give the completed mark a quiet beat before revealing the workspace.
    if (!reducedMotion)
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    // Let React commit the initialized workspace or its startup error.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        splash.dataset.dismissed = "true";
        setTimeout(
          () => {
            splash.remove();
            document.getElementById("root")?.removeAttribute("inert");
          },
          reducedMotion ? 0 : 200,
        );
      }),
    );
  });
}
