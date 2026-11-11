# Getting Started tour

The tour is ordinary editable BlockSuite content. `src/features/getting-started/index.ts` constructs two notebooks, native diagrams/databases, source references, and attachment blocks. Revision 2 includes thirteen sections, a visible canvas PDF preview in section 09, and a playable YouTube embed in section 13. The original sample assets live in `public/getting-started/`; the local content works offline, while YouTube playback requires internet access. Existing copies are preserved; use Settings → General → Create fresh copy to get the revised examples.

## Lifecycle and storage

Schema 5 stores the last tour identity/version independently of titles. Newly initialized workspaces have `pending=1`; existing workspaces opt in from Settings → General. Successful installation clears pending. Renaming does not change identity, and deleting a tour does not trigger automatic recreation. Open uses the existing live identity. Create fresh copy generates new IDs and a uniquely named collection and preserves previous content. A restored last tour can be opened again.

`getting_started.rs` verifies/stages local asset files, then commits documents, attachment ownership, collection membership, and tour status in one SQLite transaction. Failed transactions leave no partial catalog entries. A crash during asset staging can leave unindexed files, visible through File recovery. Asset keys are content-addressed; repeated copies reuse bytes. Both notebooks own their assets so deleting either notebook cannot invalidate the other's shared content.

## Maintaining the content

- Change copy and native block construction in the tour builder; bump the stored version when publishing a new content revision. Never overwrite already installed tour documents.
- Keep screenshots descriptive; instructions must also exist as editable text.
- `node scripts/capture-tour.mjs` launches a disposable debug build, captures actual UI crops into the asset directory, and closes normally. Rebuild a debug executable first. Captures use clean sample content only. Keep crops legible and preserve aspect ratio.
- `scripts/create-tour-assets.py` recreates the original two-page PDF and text checklist using reportlab. Inspect both rendered PDF pages after edits. The highlight source rectangle must continue matching the sentence about comfortable light.
- SVG illustrations are original editable source assets. No external image service or licensing dependency is required.
- If adding screenshots, register their filenames in the builder and retain a readable caption. Avoid photographing whole windows where a menu or control suffices.

## Checks

Run TypeScript, lint, unit tests, Rust tests/clippy, and the native Getting Started acceptance suite. Verify first launch, idempotent opening, fresh copies, edits after reopening, Trash/restore, offline media, PDF source navigation, both views, and native diagrams/databases. Inspect screenshots at 100% and 150% scaling. Then run `pnpm update:running`; it saves/closes the installed app normally and verifies the replacement executable before launching it.

The full tour is a large whiteboard. For image/PDF exports, use a smaller example notebook or an individual Page note; existing export size limits still apply.
