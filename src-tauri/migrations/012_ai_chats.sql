-- Ask Knot chats live in the workspace so backups and restores include them
-- (docs/AI.md, "Saved chats"). `data` is the chat JSON written by the
-- interface; Rust checks its size and identity but does not interpret it.
CREATE TABLE ai_chats (
  id TEXT PRIMARY KEY,
  updated INTEGER NOT NULL,
  data TEXT NOT NULL
);
INSERT INTO schema_migrations VALUES(12);
