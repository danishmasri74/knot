-- YouTube transcripts for the video side panel (docs/YOUTUBE-TRANSCRIPT-PLAN.md).
-- One row per video, keyed by YouTube video ID, so every card for the same
-- video shares it. `data` is the transcript JSON written by youtube.rs.
CREATE TABLE video_transcripts (
  video_id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  kind TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
INSERT INTO schema_migrations VALUES(13);
