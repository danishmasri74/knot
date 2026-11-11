/** Navigate the visible shell instead of bypassing its disclosure menus. */
export async function openShellMenu(page, label) {
  if (await page.locator("dialog.global-search[open]").count())
    await page
      .getByRole("button", { name: "Close search", exact: true })
      .click();
  if (label === "Workspace actions") {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    return;
  }
  const summary = page.getByLabel(label, { exact: true });
  if (!(await summary.evaluate((element) => element.parentElement.open)))
    await summary.click();
}
export async function clickShellButton(page, name) {
  const documentActions = [
    "Browser",
    "Card Deck",
    "Delete document",
    "PDF reader",
    "Backlinks",
    "Export",
    "Reference",
    "Attach",
  ];
  const workspaceActions = [
    "Manage backups",
    "Trash & recovery",
    "Check workspace",
    "Orphan quarantine",
    "Back up workspace",
    "Restore backup",
  ];
  if (name === "Switch workspace") {
    await openShellMenu(page, "Workspace actions");
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page
      .getByRole("button", { name: "Manage workspaces", exact: true })
      .click();
    return;
  }
  if (documentActions.includes(name))
    await openShellMenu(page, "Document actions");
  else if (workspaceActions.includes(name)) {
    if (name === "Trash & recovery") {
      await page.getByRole("button", { name: "Trash", exact: true }).click();
      return;
    }
    await openShellMenu(page, "Workspace actions");
    if (["Back up workspace", "Restore backup"].includes(name))
      await page
        .getByRole("button", { name: "Manage backups", exact: true })
        .click();
    if (name === "Manage backups") name = "Backups";
    if (name === "Check workspace") name = "Workspace health";
    if (name === "Orphan quarantine") name = "Review files";
  }
  await page.getByRole("button", { name, exact: true }).click();
  if (name === "Delete document") {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Move to Trash", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
  }
}
