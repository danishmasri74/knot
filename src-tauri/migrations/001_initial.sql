CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
INSERT INTO schema_migrations VALUES(1);
CREATE TABLE objects(id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('note','whiteboard')), updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX objects_updated ON objects(deleted_at, updated_at DESC);
CREATE INDEX objects_title ON objects(title COLLATE NOCASE);
CREATE TABLE documents(object_id TEXT PRIMARY KEY REFERENCES objects(id), collection_state BLOB NOT NULL, document_state BLOB NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE attachments(id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, UNIQUE(id,sha256));
CREATE INDEX attachments_hash ON attachments(sha256);
CREATE TABLE object_attachments(object_id TEXT NOT NULL REFERENCES objects(id), attachment_id TEXT NOT NULL REFERENCES attachments(id), PRIMARY KEY(object_id,attachment_id));
