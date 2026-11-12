-- Notebook sharing (docs/NOTEBOOK-SHARING-PLAN.md, "Schema 11").
-- Where an imported notebook came from, shown as "From <name>".
CREATE TABLE notebook_origins (
  object_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  shared_by TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  source_id TEXT NOT NULL
);
-- Titles for referenced notebooks that weren't shared, so references can
-- show "Not shared" with a title instead of "unavailable".
CREATE TABLE unshared_references (
  object_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  shared_by TEXT NOT NULL
);
INSERT INTO schema_migrations VALUES(11);
