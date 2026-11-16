export async function createNotebook(page, canvas = false) {
  // The Library tab has its own copy of this button; use the sidebar's.
  await page
    .getByRole("complementary", { name: "Workspace navigation" })
    .getByRole("button", { name: "New notebook…", exact: true })
    .click();
  await page
    .getByLabel("Notebook name", { exact: true })
    .fill("Untitled notebook");
  await page.getByLabel("Notebook name", { exact: true }).press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
      "false",
  );
  if (canvas) {
    await page.getByRole("button", { name: "Canvas", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector(".app-shell")?.getAttribute("aria-busy") ===
        "false",
    );
  }
}
