CREATE TABLE favorites (
    object_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE
);
INSERT INTO schema_migrations VALUES(4);
