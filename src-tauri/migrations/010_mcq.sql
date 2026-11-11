CREATE TABLE mcq_attempts (
    id TEXT PRIMARY KEY NOT NULL,
    notebook_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    definition TEXT NOT NULL,
    option_id TEXT NOT NULL,
    correct INTEGER NOT NULL CHECK(correct IN (0,1)),
    submitted_at INTEGER NOT NULL
);
CREATE INDEX mcq_attempts_notebook_card ON mcq_attempts(notebook_id, card_id);
CREATE TABLE mcq_progress (
    notebook_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    option_id TEXT,
    correct INTEGER CHECK(correct IN (0,1)),
    PRIMARY KEY(notebook_id, card_id)
);
CREATE TABLE mcq_drafts (id TEXT PRIMARY KEY NOT NULL, content TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(10);
