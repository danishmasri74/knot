# Storage format 1

Default location: `%LOCALAPPDATA%/com.knot.desktop/Workspace`. Restored workspaces are siblings named `restored-<uuid>`. `active-workspace.txt` selects a validated child directory.

```text
workspace.json             stable workspace UUID, format_version: 1
knot.db                    SQLite metadata and Yjs snapshots
knot.db-wal / knot.db-shm   SQLite runtime files; never copy these as backup
assets/<first 2>/<sha256>   original bytes (extensionless, MIME in metadata)
cache/thumbnails/          regenerable; currently unused
cache/previews/<document>/ regenerable canvas card preview SVGs (<note>.<fingerprint>.img)
backups/                   temporary SQLite backup snapshots
```

The initial transactional migration creates objects, documents, attachments, object_attachments, and schema_migrations. `PRAGMA user_version` prevents opening newer databases. Foreign keys are enabled. WAL plus synchronous FULL protects acknowledged transactions. Startup runs quick_check and refuses malformed manifests; existing files are not reset on error.

Database schema version 3 replaces folders and tags with `collections` and the indexed many-to-many `collection_objects` table. Version 1 and 2 databases upgrade transactionally, including old backup restores. The migration preserves populated groups, merges equal names using SQLite NOCASE, retains Trash memberships, removes empty groups, and drops the old folder column and folder/tag tables. Pre-migration archives retain the old schema. The manifest/archive format stays version 1; older binaries reject schema 3.

A notebook may belong to any number of collections. Names are trimmed, limited to 100 UTF-8 bytes, and unique using SQLite NOCASE (ASCII case-insensitive). Membership replacement and create-with-membership are atomic. Deleting a collection cascades only to its memberships; permanently deleting a notebook cascades to that notebook's memberships. Editor snapshots and edit timestamps are untouched by grouping changes. Filters use stable IDs and indexed relationships, combine with title search, exclude soft-deleted notebooks, and paginate in groups of 100. Names and memberships are included in SQLite backups automatically.

## Canvas preview cache

Canvas card preview SVGs are written after a fresh capture, when the app is idle, to `cache/previews/<document>/<note>.<fingerprint>.img` (temp file plus rename, at most 8 MiB each). The editor computes the SHA-256 fingerprint from the card's block model (excluding position and stacking), rendered text, measured content size, computed font and colors, theme, editor and root inline styles, device pixel ratio and the hashed production stylesheet/script URLs. A lookup returns only an exact fingerprint match, so a hit is the same SVG a fresh capture would produce; each card keeps only its latest fingerprint. Rasterized bitmaps are not cached because canvases drawn from `foreignObject` SVGs cannot be read back. Successful canvas preparation prunes entries for cards no longer in the document, and permanently deleting a notebook removes its folder. Every cache failure, including a corrupt file, falls back to a normal capture. Cache file IO never holds the workspace lock. Backups and relocation omit the cache. There is no global size cap yet; growth is bounded by live cards per document.

## Editor snapshots

BlockSuite 0.19.5 uses a root collection Y.Doc with metadata and a separate spaceDoc subdocument. The adapter stores **both** `Y.encodeStateAsUpdate(collection.doc)` and `Y.encodeStateAsUpdate(doc.spaceDoc)` together. Restore applies the root state first, retrieves the existing document, applies its space state, then loads the block model. Missing roots fail closed rather than initialize over an existing snapshot.

Changes to either Y.Doc queue a save after 600 ms. Writes are serialized; edits arriving during a write cause another snapshot. Errors retain the dirty generation for explicit retry. There is one current snapshot pair, not an ever-growing update log. Yjs history/tombstones may still grow within a snapshot; deeper CRDT compaction is deferred. Snapshot payload limit: 64 MiB combined.

The application intercepts normal close and flushes before destroying the window. OS shutdown/power loss is covered only to the last acknowledged transaction. Backups also flush active edits first. No IndexedDB provider is configured.

## Attachments

BlockSuite source IDs map to SHA-256 content paths through attachments metadata. Different BlockSuite IDs may resolve to one physical hash. Binary writes use a unique temporary file, file sync, hash verification, and rename before the metadata transaction. Imports preserve name, MIME, size, and extension in the original filename when the source is a File. Blob-only paste may have a generic name.

Metadata tracks object/attachment references conservatively. References are retained when blocks or objects are deleted, so cleanup cannot accidentally remove undo/recovery content. No automatic garbage collection is performed. Interrupted imports can leave an unreferenced physical file or `.tmp`; leave these intact until a future audited orphan-cleanup tool. Reads validate content hashes and report missing/corrupt assets. Current bridge serializes one attachment through IPC as bytes (100 MiB limit); streaming large-file imports is future work.

The Check workspace command streams hashes for catalogued assets and scans for unreferenced physical files. This audit is read-only. Startup failures leave the recovery shell available; selecting Restore can recover into a new workspace even when the previous database cannot open. Missing manifests or databases are reported rather than initialized over existing data.

## Native backup

A `.knot` ZIP includes workspace.json, knot.db created by SQLite's backup API, and all catalogued attachment hashes, including soft-deleted object assets. Cache and WebView state are unnecessary. Archive restoration rejects unexpected paths, traversal, symlinks, duplicate entries, excessive counts/sizes, invalid workspace versions, SQLite corruption, foreign-key violations, and missing or mismatched attachment hashes. Restoration is staged in a new UUID directory and selected only after validation. The archive format intentionally has no standard-export fidelity claim.

`workspace.lock` is a non-authoritative OS lock file, excluded from archives. SQLite object titles commit in the same transaction as document snapshots. Restored-workspace selection uses a synced temporary file and rename.

Schema version 4 adds `favorites`, keyed by notebook ID with cascading deletion. Favorites are workspace-local, included in backups, hidden while a notebook is trashed, and retained on restore. The guarded migration creates a pre-migration recovery archive for existing workspaces.

Schema version 5 adds `getting_started`: a singleton containing pending first-run creation, the last tour document identity, and its content version. Existing workspaces opt in; new databases mark the tour pending. Deletion does not reset the marker. The guarded migration retains a verified pre-migration archive. Tour installation commits document snapshots, asset ownership, collection membership, and the marker atomically after staging verified asset files.

## Card Deck

Schema 9 adds a workspace-owned `card_deck` JSON record. Note-card content is independent of document placements; each document stores its instance-to-card mapping in the `knot:card-links` Yjs map. Plain `affine:edgeless-text` blocks are not enrolled. Deck content and modified document snapshots commit in the same SQLite transaction. Opening an editor enrolls existing notes across the catalog and hydrates shared content; this currently loads all live documents, so large workspaces may have a higher opening cost.

Schema 12 adds `ai_chats` (id, updated, data): one Ask Knot chat per row as the JSON the interface writes, at most 16 MiB each. Rust checks the ID, size and that the JSON names the same chat, but does not interpret the turns. Chats are workspace data, so SQLite backups, restores and relocation include them; `.knotbook` sharing never copies them. Older builds refuse a schema-12 database, as with every schema change.

Schema 13 adds `video_transcripts` (video_id, language, kind, fetched_at, data): one saved YouTube transcript per video, keyed by its 11-character video ID, so every card for the same video shares it ([YOUTUBE-TRANSCRIPT-PLAN.md](YOUTUBE-TRANSCRIPT-PLAN.md)). `data` is versioned JSON written by `youtube.rs` (title, channel, duration, chosen and available tracks, chapters, timed segments), at most 2 MiB. Fetching another caption language replaces the row. Backups, restores and relocation include it through the database; `.knotbook` sharing doesn't copy it, so a recipient fetches the transcript again. Older builds refuse a schema-13 database.

Deleting a placement retains its card. Explicit deck deletion removes live placements and retains a tombstone so restored or undone placements cannot resurrect it. Backups include the deck through the database. Trash purging retains attachment records referenced by deck content, including cards with no remaining placements.

Empty Trash also empties deleted cards: each becomes a content-free tombstone (`deleted` and `purged`, `nodes: []`) that keeps its ID and generation, so notebooks that still link to it drop the placement on open instead of failing. Its attachments are released by the same purge.

## UI preferences

Preferences live in the WebView's localStorage under `knot.*` keys (theme, editor settings, sidebar recents/pins/favorites order per workspace, layouts). WebView2 can reset that storage as a whole, so Knot mirrors those keys (except Ask Knot drafts) to `ui-preferences.json` in the data folder, beside the workspaces and outside every backup. It is written atomically after each change and while closing. At startup, a storage without the `knot.ui-mirror.v1` marker is treated as reset and refilled from the file before the app loads; keys already present win. Restoring a backup copies the sidebar preferences to the restored workspace's ID.


## Retained website evidence

Version-1 web captures have application-generated source/capture/section IDs, original/final URLs, capture time, nullable author/publication metadata, content type, extraction version, content hash, warnings and selected excerpts. Raw HTML and unapplied full captures remain ephemeral. Ask Knot saves only bounded selected evidence in frozen chat requests. Since schema 12, chats and chat-only evidence are stored in the workspace `ai_chats` table and included in workspace backups. Storage failures expose Retry save. Reopen/regenerate does not refetch; Refresh creates a new immutable capture.

Applied `knot:web-source` blocks use ordinary Yjs native child content: `text` supports search/export and `evidence` carries validated bounded versioned JSON metadata plus supporting sections. They contain no remote assets or hidden permanent attachments and require no SQLite migration. Their content travels with Card Deck sharing/revisions, snapshots, clipboard snapshots, workspace backups and restore. Each record is bounded to 170,000 serialized bytes; supporting excerpts and omitted-section warnings remain readable without the original chat/website. HTML/plain-text clipboard and Markdown export convert them into quote/source paragraphs.
