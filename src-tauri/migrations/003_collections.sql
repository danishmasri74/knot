CREATE TABLE collections(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0));
CREATE TABLE collection_objects(object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY(object_id, collection_id));
CREATE INDEX collection_objects_collection ON collection_objects(collection_id, object_id);
-- Equal folder/tag names intentionally become one collection with both memberships.
INSERT INTO collections SELECT 'folder:' || id, name FROM folders WHERE EXISTS(SELECT 1 FROM objects WHERE folder_id=folders.id);
INSERT OR IGNORE INTO collections SELECT 'tag:' || id, name FROM tags WHERE EXISTS(SELECT 1 FROM object_tags WHERE tag_id=tags.id);
INSERT OR IGNORE INTO collection_objects SELECT o.id,c.id FROM objects o JOIN folders f ON f.id=o.folder_id JOIN collections c ON c.name=f.name;
INSERT OR IGNORE INTO collection_objects SELECT ot.object_id,c.id FROM object_tags ot JOIN tags t ON t.id=ot.tag_id JOIN collections c ON c.name=t.name;
DROP TABLE object_tags;
DROP INDEX objects_folder;
ALTER TABLE objects DROP COLUMN folder_id;
DROP TABLE folders;
DROP TABLE tags;
INSERT INTO schema_migrations VALUES(3);
