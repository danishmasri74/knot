-- Identity survives renames and deletion; existing workspaces opt in.
CREATE TABLE getting_started(singleton INTEGER PRIMARY KEY CHECK(singleton=1), pending INTEGER NOT NULL DEFAULT 0, welcome_id TEXT, version INTEGER NOT NULL DEFAULT 0);
INSERT INTO getting_started(singleton) VALUES(1);
INSERT INTO schema_migrations VALUES(5);
