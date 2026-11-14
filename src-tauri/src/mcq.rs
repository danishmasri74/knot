use crate::storage::{now, Result, Workspace};
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    card_id: String,
    revision: String,
    option_id: Option<String>,
    correct: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mutation {
    notebook_id: String,
    card_id: String,
    revision: String,
    option_id: Option<String>,
    attempt_id: Option<String>,
}

pub fn load(workspace: &Workspace, notebook_id: &str) -> Result<Vec<Progress>> {
    let mut query = workspace.db.prepare(
        "SELECT p.card_id,p.revision,p.option_id,p.correct FROM mcq_progress p
         JOIN objects o ON o.id=p.notebook_id WHERE p.notebook_id=?1 AND o.deleted_at IS NULL",
    )?;
    let rows = query.query_map([notebook_id], |row| {
        Ok(Progress {
            card_id: row.get(0)?,
            revision: row.get(1)?,
            option_id: row.get(2)?,
            correct: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn apply(tx: &Transaction<'_>, mutations: &[Mutation]) -> Result<()> {
    if mutations.is_empty() {
        return Ok(());
    }
    let raw: String = tx.query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0))?;
    let deck: serde_json::Value = serde_json::from_str(&raw)?;
    for entry in mutations {
        let active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM objects WHERE id=?1 AND deleted_at IS NULL)",
            [&entry.notebook_id],
            |row| row.get(0),
        )?;
        if !active {
            return Err("This notebook is unavailable".into());
        }
        let card = &deck[&entry.card_id];
        let nodes = card["nodes"].as_array().ok_or("This card is unavailable")?;
        if card["deleted"].as_bool() == Some(true)
            || nodes.len() != 1
            || nodes[0]["props"]["sys:flavour"]["value"] != "knot:mcq"
        {
            return Err("This quiz is unavailable".into());
        }
        let definition = &nodes[0]["props"]["prop:definition"]["value"];
        if definition["schemaVersion"] != 1 || definition["gradingRevision"] != entry.revision {
            return Err("This question has changed. Answer the current version.".into());
        }
        let options = definition["options"]
            .as_array()
            .ok_or("Invalid quiz options")?;
        let valid_option = |id: &str| options.iter().any(|option| option["id"] == id);
        let answer = definition["correctOptionId"]
            .as_str()
            .ok_or("Invalid answer key")?;
        if !(2..=4).contains(&options.len())
            || !valid_option(answer)
            || entry
                .option_id
                .as_deref()
                .is_some_and(|id| !valid_option(id))
        {
            return Err("Invalid quiz answer".into());
        }
        let mut correct = None;
        if let Some(attempt) = &entry.attempt_id {
            let selected = entry.option_id.as_deref().ok_or("Choose an answer first")?;
            correct = Some(selected == answer);
            let inserted = tx.execute(
                "INSERT INTO mcq_attempts VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO NOTHING",
                params![
                    attempt,
                    entry.notebook_id,
                    entry.card_id,
                    definition.to_string(),
                    selected,
                    correct,
                    now()
                ],
            )?;
            if inserted == 0 {
                continue;
            }
        }
        tx.execute(
            "INSERT INTO mcq_progress VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(notebook_id,card_id) DO UPDATE SET
             revision=excluded.revision, option_id=excluded.option_id, correct=excluded.correct",
            params![
                entry.notebook_id,
                entry.card_id,
                entry.revision,
                entry.option_id,
                correct
            ],
        )?;
    }
    Ok(())
}

pub fn reset(workspace: &mut Workspace, notebook: &str) -> Result<()> {
    let tx = workspace.db.transaction()?;
    tx.execute("DELETE FROM mcq_progress WHERE notebook_id=?1", [notebook])?;
    tx.execute("DELETE FROM mcq_attempts WHERE notebook_id=?1", [notebook])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn publication_rolls_back_document_deck_and_draft_across_reopen() {
        use crate::storage::{DocumentWrite, Snapshot};

        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("publication");
        let mut workspace = Workspace::open(root.clone()).unwrap();
        let id = workspace.create("note").unwrap();
        let draft_id = "inline:v1:original:note";
        let published = DocumentWrite {
            id: id.clone(),
            create: false,
            snapshot: Snapshot {
                collection: vec![1],
                document: vec![2],
                title: None,
            },
        };
        let deck = r#"{"question":{"id":"question","nodes":[]}}"#;
        workspace
            .db
            .execute("INSERT INTO mcq_drafts VALUES(?1, '{}')", [draft_id])
            .unwrap();
        workspace.db.execute_batch(
            "CREATE TRIGGER fail_publication BEFORE DELETE ON mcq_drafts
             BEGIN SELECT RAISE(ABORT, 'injected draft deletion failure'); END;",
        ).unwrap();
        assert!(workspace
            .save_documents_with_mcq(std::slice::from_ref(&published), Some(deck), &[], Some(draft_id))
            .is_err());
        drop(workspace);

        let mut workspace = Workspace::open(root.clone()).unwrap();
        let read_deck = |workspace: &Workspace| -> String {
            workspace.db.query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0)).unwrap()
        };
        let draft_count = |workspace: &Workspace| -> i64 {
            workspace.db.query_row("SELECT count(*) FROM mcq_drafts WHERE id=?1", [draft_id], |r| r.get(0)).unwrap()
        };
        assert!(workspace.load(&id).unwrap().is_none());
        assert_eq!(read_deck(&workspace), "{}");
        assert_eq!(draft_count(&workspace), 1);
        workspace.db.execute_batch("DROP TRIGGER fail_publication").unwrap();
        workspace
            .save_documents_with_mcq(&[published], Some(deck), &[], Some(draft_id))
            .unwrap();
        drop(workspace);

        let workspace = Workspace::open(root).unwrap();
        assert_eq!(workspace.load(&id).unwrap().unwrap().document, vec![2]);
        assert_eq!(read_deck(&workspace), deck);
        assert_eq!(draft_count(&workspace), 0);
    }

    #[test]
    fn upgrades_deck_and_preserves_independent_attempts_through_backup() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("original");
        let workspace = Workspace::open(root.clone()).unwrap();
        let a = workspace.create("note").unwrap();
        let b = workspace.create("whiteboard").unwrap();
        workspace
            .db
            .execute_batch(
                "DROP TABLE mcq_progress; DROP TABLE mcq_attempts; DROP TABLE mcq_drafts;
             DROP TABLE notebook_origins; DROP TABLE unshared_references; DROP TABLE ai_chats; DROP TABLE video_transcripts; DELETE FROM schema_migrations WHERE version>=10; PRAGMA user_version=9;",
            )
            .unwrap();
        drop(workspace);

        let mut workspace = Workspace::open(root).unwrap();
        let deck = json!({"card": {"id": "card", "nodes": [{
            "props": {
                "sys:flavour": {"type": "json", "value": "knot:mcq"},
                "prop:definition": {"type": "json", "value": {
                    "schemaVersion": 1, "gradingRevision": "r1", "question": "Which is even?",
                    "options": [{"id": "three", "text": "Three"}, {"id": "four", "text": "Four"}],
                    "correctOptionId": "four", "explanation": "Four is divisible by two.", "sources": []
                }}
            },
            "children": []
        }]}}).to_string();
        let attempt = Mutation {
            notebook_id: a.clone(),
            card_id: "card".into(),
            revision: "r1".into(),
            option_id: Some("three".into()),
            attempt_id: Some("a-first".into()),
        };
        workspace
            .save_documents_with_mcq(&[], Some(&deck), std::slice::from_ref(&attempt), None)
            .unwrap();
        assert_eq!(load(&workspace, &a).unwrap()[0].correct, Some(false));
        assert!(load(&workspace, &b).unwrap().is_empty());
        workspace
            .save_documents_with_mcq(&[], None, &[attempt], None)
            .unwrap();
        let stale = Mutation {
            notebook_id: b.clone(),
            card_id: "card".into(),
            revision: "older".into(),
            option_id: Some("four".into()),
            attempt_id: Some("b-first".into()),
        };
        assert!(workspace
            .save_documents_with_mcq(&[], None, &[stale], None)
            .is_err());
        let attempt_b = Mutation {
            notebook_id: b.clone(),
            card_id: "card".into(),
            revision: "r1".into(),
            option_id: Some("four".into()),
            attempt_id: Some("b-first".into()),
        };
        workspace
            .save_documents_with_mcq(&[], None, &[attempt_b], None)
            .unwrap();
        let count: i64 = workspace
            .db
            .query_row("SELECT count(*) FROM mcq_attempts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);

        let archive = temp.path().join("quiz.knot");
        crate::backup::export(&workspace, &archive).unwrap();
        let restored = crate::backup::restore(&archive, temp.path()).unwrap();
        let mut workspace = Workspace::open(restored).unwrap();
        assert_eq!(load(&workspace, &a).unwrap()[0].correct, Some(false));
        assert_eq!(load(&workspace, &b).unwrap()[0].correct, Some(true));
        reset(&mut workspace, &a).unwrap();
        assert!(load(&workspace, &a).unwrap().is_empty());
        assert_eq!(load(&workspace, &b).unwrap()[0].correct, Some(true));
    }
}
