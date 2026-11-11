ALTER TABLE collections ADD COLUMN deleted_at INTEGER;
INSERT INTO schema_migrations VALUES(8);
