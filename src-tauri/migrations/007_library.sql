ALTER TABLE objects ADD COLUMN created_at INTEGER;
CREATE TRIGGER objects_creation_date AFTER INSERT ON objects WHEN NEW.created_at IS NULL
BEGIN UPDATE objects SET created_at = NEW.updated_at WHERE id = NEW.id; END;
CREATE INDEX objects_library_updated ON objects(deleted_at, updated_at DESC, id);
CREATE INDEX objects_library_created ON objects(deleted_at, created_at DESC, id);
INSERT INTO schema_migrations VALUES(7);
