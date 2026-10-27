CREATE TABLE folders(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0));
CREATE TABLE tags(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0));
ALTER TABLE objects ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX objects_folder ON objects(folder_id, deleted_at, updated_at DESC);
CREATE TABLE object_tags(object_id TEXT NOT NULL REFERENCES objects(id), tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(object_id, tag_id));
CREATE INDEX object_tags_tag ON object_tags(tag_id, object_id);
INSERT INTO schema_migrations VALUES(2);
