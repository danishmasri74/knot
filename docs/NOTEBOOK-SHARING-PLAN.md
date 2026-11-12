# Notebook sharing plan

Status (12 November 2026): slice 1 (Share as file) is committed. Slices 2 (import) and 3 (double-click opening, `.knotbook` icon) are implemented and checked, but not yet committed. Codex fixed the Windows association; see [HANDOFF-KNOTBOOK-OPEN-WITH.md](HANDOFF-KNOTBOOK-OPEN-WITH.md), "Resolution". Slice 4 ("Not shared" placeholders) and slice 5 (two-PC test, 0.3.0 release) remain. Designs: the "Knot notebook sharing" design canvas (artboards 1–9). Ships as **0.3.0**: it adds a schema migration, which requires a minor version bump.

## Goal

Share a notebook with another Knot user as one file, with no server and no accounts. This follows the local-first pattern of OneNote `.onepkg`, Evernote `.enex` and AFFiNE snapshots: send a file, and importing it creates an **editable copy**. Live collaboration and merging re-imports are out of scope (see "Later").

## Decisions

- **File:** `.knotbook`, a ZIP. `.knot` stays the full-workspace backup format.
- **Contents:**
  - the chosen notebooks, exactly as stored (Page, Canvas and every block);
  - the card-deck cards they use;
  - the attachments they use.
  - Collections, favorites, quiz attempts and progress, Ask Knot chats and Trash are never included.
- **References:**
  - Notebooks shown on a canvas (`affine:embed-synced-doc`) are included by default, at every depth.
  - Link cards (`affine:embed-linked-doc`) and inline references are offered unticked, at every depth.
  - Loops and diamonds list each notebook once. Notebooks in Trash are never offered.
- **Missing references** keep their ID and title and show as **Not shared**. They resolve by themselves if that notebook is imported later.
- **Import creates copies.** A notebook she already has offers **Keep both** (the default; adds "Waves 2") or **Replace mine** (backs up first). An identical one is shown as **Up to date** and unticked.
- **Provenance:** imported notebooks show a **From <name>** tag. The sender types the name once in the share dialog and it's remembered on that PC. It is free text, not identity.
- **Opening:** double-clicking a `.knotbook` opens Knot, or brings the running Knot forward, straight into the import dialog. There's also **Import notebook…** in the Library.

## Package format (version 1)

```
Physics.knotbook  (ZIP, deflate)
  manifest.json
  notebooks/<id>/collection.bin   documents.collection_state
  notebooks/<id>/document.bin     documents.document_state
  assets/<sha256>                 attachment bytes, stored once
  cards.json                      card-deck entries used by these notebooks
```

`manifest.json`:

- `format: "knotbook"`, `formatVersion: 1`, `minKnotVersion` (for example `"0.3.0"`), `createdWith`, `exportedAt` and `sharedBy`.
- `root`: the notebook the share started from.
- `notebooks: [{ id, title, kind, updatedAt, sha256, parent, role: "root" | "canvas" | "linked" }]`. `sha256` is the hash of `document.bin`; `parent` and `role` let the import dialog draw the same tree as the export dialog.
- `attachments: [{ id, sha256, name, mime, size }]`, the rows from `attachments`, deduplicated by hash.
- `unshared: [{ id, title }]`, references to notebooks that weren't included, so they can show a title.

**Reading is strict.** The importer reuses the archive checks from `backup.rs`:

- only the paths above, with no traversal, symlinks or duplicate entries;
- limits on entry count, per-file size and total size;
- each asset must match its hash;
- every `notebooks/<id>` must be listed in the manifest, and vice versa;
- each snapshot pair must decode in an isolated worker, as `integrity` already does (collection identity and exactly one page root).

Results:

- `formatVersion` above 1, or `minKnotVersion` newer than the running Knot → **Update Knot first**.
- Anything malformed → **Can't open this file**.
- A ZIP containing `workspace.json` + `knot.db` is a workspace backup → it's pointed to Restore backup.

## Export (artboards 1–3)

1. **Entry points:**
   - **Share as file…** in the document menu's "Read & export" group, after Export;
   - right-clicking a notebook in the Library or sidebar.
   - It uses `ShellIcon` `notebook`, plus an outgoing arrow variant as a new `share` icon.
2. **Build the list.** Flush pending edits, then walk saved snapshots from the root:
   - Extend `references.ts` so `referenceIds` also reports each reference's kind: canvas placement (`embed-synced-doc`), link card (`embed-linked-doc`), or inline.
   - Placements are followed automatically and links are offered, as `children` and `offered`, recomputed whenever a box is ticked.
   - The walk keeps a visited set (loops, diamonds) and uses the reference catalog to skip Trash.
3. **Dialog:**
   - **Included** and **Linked** sections;
   - **Your name**, stored per device; it's required, and empty the first time;
   - a live total of notebooks and size;
   - **Save…** opens Windows' Save dialog from Rust, defaulting to `<root title>.knotbook`.
4. **Write.** A new Rust command, `export_knotbook(objects, cards, unshared, sharedBy)`:
   - reads snapshots and attachment rows under the workspace mutex;
   - writes the ZIP with the existing `exports.rs` path (unique temp file, sync, `persist_noclobber`);
   - only uses a destination path that came from the native dialog.
5. **Done:** the notice "Saved Physics.knotbook" with **Show in folder**.

The cards to include come from each included notebook's `knot:card-links` Yjs map.

## Import (artboards 4–8)

1. **Open:**
   - **Double-click** (Knot not running): the file path arrives in `argv`.
   - **Double-click** (Knot already running): `tauri-plugin-single-instance`, registered first, hands `argv` to the running instance, which brings its window to the front. Without it, the second Knot would fail on the workspace lock.
   - **Import notebook…**: a native Open dialog.
   - In every case Rust keeps the path and gives the frontend an opaque token. This matches the existing rule that no command takes an arbitrary path.
   - If the workspace is still opening, or an operation is in progress, the import waits for it.
2. **Inspect.** `inspect_knotbook(token)` validates fully and returns the manifest plus a status per notebook:
   - **New**: the ID isn't in the workspace;
   - **In your Library**: the ID exists and the content differs;
   - **Up to date**: the ID exists and `sha256` matches.
   - Or it returns a blocking reason instead.
3. **Dialog:**
   - the tree with checkboxes and **All / None**;
   - tags, plus the **Keep both / Replace mine** choice (`ChoicePopover`);
   - "N linked notebooks weren't shared";
   - an optional **Collection** (native `<select>`);
   - **Import N**.
   - Unticking a notebook another one shows on its canvas leaves its spot as **Not shared**.
4. **Commit.** `import_knotbook(token, choices)`:
   - **Replace mine** → make a managed backup first, using the same path updates use.
   - **Keep both** → give that notebook a new UUID, and rewrite every `pageId` in the imported snapshots that pointed at the old one. Its cards get new IDs too, so the copy never shares cards with the original. The rewrite runs in the frontend on decoded Yjs documents, before the commit.
   - **New** → keep the original ID. A card ID that already exists with different content gets a new ID, so nothing of hers is overwritten. **Replace mine** overwrites the shared notebook's cards.
   - **Attachments:** stage any missing hashes as verified temp files, renamed into place before the transaction. Insert `attachments` rows that aren't there. A different hash under the same attachment ID refuses the import.
   - **One SQLite transaction:**
     - `objects` and `documents` rows;
     - `object_attachments`;
     - the card-deck merge;
     - collection membership;
     - provenance and placeholder rows (below).
   - Any failure rolls back and leaves the workspace unchanged.
5. **Done:** "Imported N notebooks" with **Open**. The reference catalog refreshes, so links resolve immediately.

## Schema 11

```sql
-- Where an imported notebook came from (shown as "From <name>").
CREATE TABLE notebook_origins (
  object_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  shared_by TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  source_id TEXT NOT NULL      -- original ID; differs after Keep both
);
-- Titles for referenced notebooks that weren't shared.
CREATE TABLE unshared_references (
  object_id TEXT PRIMARY KEY,  -- the missing notebook's ID
  title TEXT NOT NULL,
  shared_by TEXT NOT NULL
);
```

- An `unshared_references` row is deleted when a notebook with that ID arrives. Backups include both tables automatically.
- Schema 11 means older builds refuse the database, which is the existing rule. Version 0.3.0 with `minKnotVersion` 0.3.0 keeps that consistent for packages too.
- The guarded migration keeps its pre-migration archive, like the earlier migrations.

## Not shared (artboard 9)

- Missing targets currently render as "unavailable".
- When `unshared_references` has the ID, a placement or link card shows instead: the notebook icon, the title, "Not shared", and a remove button (×). Inline references become a muted tag with the title and a "Not shared" tooltip.
- Opening one does nothing harmful.
- **Remove card** deletes only that block, and can be undone like any canvas edit.

## File association and installer

- **Association:** `bundle.fileAssociations: [{ ext: ["knotbook"], name: "Knot notebook", description: "Knot notebook", role: "Editor" }]`.
- **Icon:** ship `icons/knotbook/knotbook.ico` as a bundle resource. In `installer/knot.nsi`, point the association's `DefaultIcon` at it instead of `knot.exe,0`. The uninstaller already removes associations.
- **Single instance:** add `tauri-plugin-single-instance`. Forwarded paths go through the same token path.

## Also in this release

- **Settings → Updates buttons:** change `.updates-primary` to Knot's `.primary` colors (`light-dark(#626262, #979797)`), matching the other dialogs and the sharing designs.

## Slices

1. **Format and export:**
   - the reference kinds in `references.ts`;
   - the dependency walk with tests (nesting, loops, diamonds, Trash);
   - `export_knotbook` with Rust round-trip tests;
   - the share dialog, name preference and notice.
2. **Import:**
   - schema 11;
   - `inspect_knotbook` with validation tests (traversal, oversize, hash mismatch, bad snapshot, newer format, backup file);
   - the import dialog;
   - the commit, with tests for New, Keep both remapping, Replace with backup, Up to date, card conflicts, attachment dedupe, rollback;
   - **Import notebook…** in the Library.
3. **Opening by double-click:** single-instance, file association, the `.knotbook` icon and the installer change. Verify with Knot closed, open and busy.
4. **Not shared:** placeholder rendering, links resolving when the notebook later arrives, **Remove card**.
5. **Verification and 0.3.0:**
   - export → import round trip between two workspaces on this PC, then between two PCs;
   - your notes fingerprinted unchanged, apart from the intended imports;
   - light/dark themes, keyboard use, dropdown rules;
   - release through `pnpm release 0.3.0`. Your friend's 0.2.0 receives it via the updater.

## Later

- **Merge changes** as a third choice on re-import: apply the shared Yjs update into her copy, keeping both people's edits. The format already keeps notebook IDs for this.
- Read-only shares, live sync, and real sender identity (signing) would each need more than a file.

## Open questions

- The size cap for a `.knotbook`: the same as backups, or lower, so files stay sendable over chat apps.
- Whether **Your name** should default to the Windows account's display name, or always start empty (proposed: empty).
