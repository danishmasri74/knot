//! Ask Knot chats, stored in the workspace database so they travel with
//! workspace backups and restores. The interface owns the chat JSON; Rust only
//! checks identity and size so a bad write can't damage other chats.
use crate::storage::{Result, Workspace};
use rusqlite::params;

/// One chat, including its frozen evidence. Matches the old per-chat
/// browser-storage budget with room for long conversations.
const MAX_CHAT_BYTES: usize = 16 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

impl Workspace {
    /// Every saved chat's JSON, newest first.
    pub fn ai_chats(&self) -> Result<Vec<String>> {
        let mut query = self
            .db
            .prepare("SELECT data FROM ai_chats ORDER BY updated DESC, id")?;
        let rows = query.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn save_ai_chat(&self, id: &str, data: &str) -> Result<()> {
        if !valid_id(id) {
            return Err("Invalid chat ID".into());
        }
        if data.len() > MAX_CHAT_BYTES {
            return Err("This chat is too large to save. Start a new chat.".into());
        }
        let value: serde_json::Value = serde_json::from_str(data)?;
        if value["id"].as_str() != Some(id) || !value["turns"].is_array() {
            return Err("Chat data does not match its ID".into());
        }
        let updated = value["updated"].as_i64().unwrap_or_else(crate::storage::now);
        self.db.execute(
            "INSERT INTO ai_chats(id,updated,data) VALUES(?1,?2,?3)
             ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, data=excluded.data",
            params![id, updated, data],
        )?;
        Ok(())
    }
    pub fn delete_ai_chat(&self, id: &str) -> Result<()> {
        self.db.execute("DELETE FROM ai_chats WHERE id=?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::storage::Workspace;

    fn chat(id: &str, updated: i64, title: &str) -> String {
        serde_json::json!({"id": id, "documentId": "d", "title": title, "updated": updated, "turns": []})
            .to_string()
    }

    #[test]
    fn chats_save_replace_list_newest_first_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::open(dir.path().join("w")).unwrap();
        ws.save_ai_chat("a", &chat("a", 1, "old")).unwrap();
        ws.save_ai_chat("b", &chat("b", 2, "newer")).unwrap();
        ws.save_ai_chat("a", &chat("a", 3, "edited")).unwrap();
        let listed = ws.ai_chats().unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed[0].contains("edited") && listed[1].contains("newer"));
        ws.delete_ai_chat("a").unwrap();
        assert_eq!(ws.ai_chats().unwrap().len(), 1);
    }

    #[test]
    fn chats_reject_mismatched_invalid_or_oversized_data() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::open(dir.path().join("w")).unwrap();
        assert!(ws.save_ai_chat("a", &chat("b", 1, "x")).is_err());
        assert!(ws.save_ai_chat("../a", &chat("../a", 1, "x")).is_err());
        assert!(ws.save_ai_chat("a", "not json").is_err());
        assert!(ws.save_ai_chat("a", r#"{"id":"a"}"#).is_err());
        let huge = chat("a", 1, &"x".repeat(super::MAX_CHAT_BYTES));
        assert!(ws.save_ai_chat("a", &huge).is_err());
        assert!(ws.ai_chats().unwrap().is_empty());
    }

    #[test]
    fn chats_survive_backup_and_restore() {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::open(dir.path().join("w")).unwrap();
        ws.save_ai_chat("a", &chat("a", 1, "kept")).unwrap();
        let archive = dir.path().join("backup.knot");
        crate::backup::export(&ws, &archive).unwrap();
        let restored = crate::backup::restore(&archive, dir.path()).unwrap();
        let ws = Workspace::open(restored).unwrap();
        let listed = ws.ai_chats().unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].contains("kept"));
    }
}
