# Storage format 1

Default location: `%LOCALAPPDATA%/com.knot.desktop/Workspace`. Restored workspaces are siblings named `restored-<uuid>`. `active-workspace.txt` selects a validated child directory.

```text
workspace.json             stable workspace UUID, format_version: 1
knot.db                    SQLite metadata and Yjs snapshots
knot.db-wal / knot.db-shm   SQLite runtime files; never copy these as backup
assets/<first 2>/<sha256>   original bytes (extensionless, MIME in metadata)
cache/thumbnails/          regenerable; currently unused
cache/previews/            regenerable; currently unused
backups/                   temporary SQLite backup snapshots
```

The initial transactional migration creates objects, documents, attachments, object_attachments, and schema_migrations. `PRAGMA user_version` prevents opening newer databases. Foreign keys are enabled. WAL plus synchronous FULL protects acknowledged transactions. Startup runs quick_check and refuses malformed manifests; existing files are not reset on error.

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
