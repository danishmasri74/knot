use crate::storage::{now, Result, Snapshot, Workspace};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct Status {
    pub pending: bool,
    pub welcome_id: Option<String>,
    pub version: i64,
}
#[derive(Deserialize)]
pub struct TourDocument {
    pub id: String,
    pub snapshot: Snapshot,
}
#[derive(Deserialize)]
pub struct TourAsset {
    pub key: String,
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}
#[derive(Deserialize)]
pub struct Tour {
    pub documents: Vec<TourDocument>,
    pub assets: Vec<TourAsset>,
}
impl Workspace {
    pub fn getting_started_status(&self) -> Result<Status> {
        Ok(self.db.query_row("SELECT pending,(SELECT id FROM objects WHERE id=welcome_id AND deleted_at IS NULL),version FROM getting_started WHERE singleton=1", [], |r| Ok(Status { pending: r.get(0)?, welcome_id: r.get(1)?, version: r.get(2)? }))?)
    }
    pub fn install_getting_started(&mut self, tour: Tour, fresh: bool) -> Result<String> {
        if !fresh {
            if let Some(id) = self.getting_started_status()?.welcome_id {
                return Ok(id);
            }
        }
        if tour.documents.len() != 2 || tour.assets.len() > 24 {
            return Err("Invalid Getting Started package".into());
        }
        let welcome = tour.documents[0].id.clone();
        // Files are verified before the atomic catalog commit. Interrupted staging
        // can leave only unindexed files, handled by normal File recovery.
        let hashes = tour
            .assets
            .iter()
            .map(|a| self.stage_blob(&a.bytes))
            .collect::<Result<Vec<_>>>()?;
        let tx = self.db.transaction()?;
        for doc in &tour.documents {
            uuid::Uuid::parse_str(&doc.id)?;
            tx.execute("INSERT INTO objects(id,title,kind,updated_at) VALUES(?1,'Getting Started','whiteboard',?2)", params![doc.id, now()])?;
            Self::write_snapshot(&tx, &doc.id, &doc.snapshot)?;
            for (asset, hash) in tour.assets.iter().zip(&hashes) {
                tx.execute(
                    "INSERT OR IGNORE INTO attachments VALUES(?1,?2,?3,?4,?5)",
                    params![
                        asset.key,
                        hash,
                        asset.name,
                        asset.mime,
                        asset.bytes.len() as i64
                    ],
                )?;
                let stored: String = tx.query_row(
                    "SELECT sha256 FROM attachments WHERE id=?1",
                    [&asset.key],
                    |r| r.get(0),
                )?;
                if stored != *hash {
                    return Err("Attachment identifier collision".into());
                }
                tx.execute(
                    "INSERT INTO object_attachments VALUES(?1,?2)",
                    params![doc.id, asset.key],
                )?;
            }
        }
        let mut name = "Getting Started".to_string();
        let mut suffix = 2;
        while tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM collections WHERE name=?1)",
            [&name],
            |r| r.get::<_, bool>(0),
        )? {
            name = format!("Getting Started ({suffix})");
            suffix += 1;
        }
        let collection = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO collections(id,name,position) VALUES(?1,?2,(SELECT COALESCE(MAX(position),0)+1 FROM collections))",
            params![collection, name],
        )?;
        for doc in &tour.documents {
            tx.execute(
                "INSERT INTO collection_objects VALUES(?1,?2)",
                params![doc.id, collection],
            )?;
        }
        tx.execute(
            "UPDATE getting_started SET pending=0,welcome_id=?1,version=2 WHERE singleton=1",
            [&welcome],
        )?;
        tx.commit()?;
        Ok(welcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn package() -> Tour {
        Tour {
            documents: (0..2)
                .map(|i| TourDocument {
                    id: uuid::Uuid::new_v4().to_string(),
                    snapshot: Snapshot {
                        collection: vec![1],
                        document: vec![2],
                        title: Some(format!("Tour {i}")),
                    },
                })
                .collect(),
            assets: vec![TourAsset {
                key: "sample".into(),
                name: "sample.txt".into(),
                mime: "text/plain".into(),
                bytes: b"sample".to_vec(),
            }],
        }
    }
    #[test]
    fn tour_is_atomic_idempotent_and_preserves_edits_and_deletion() {
        let tmp = tempfile::tempdir().unwrap();
        let mut ws = Workspace::open(tmp.path().join("tour")).unwrap();
        assert!(ws.getting_started_status().unwrap().pending);
        let mut bad = package();
        bad.documents[1].snapshot.document.clear();
        assert!(ws.install_getting_started(bad, false).is_err());
        assert!(ws.list("", 0).unwrap().is_empty());
        assert!(ws.catalog().unwrap().collections.is_empty());
        assert!(ws.getting_started_status().unwrap().pending);
        let id = ws.install_getting_started(package(), false).unwrap();
        ws.rename(&id, "My edited tour").unwrap();
        assert_eq!(ws.install_getting_started(package(), false).unwrap(), id);
        assert_eq!(ws.list("", 0).unwrap().len(), 2);
        assert_eq!(ws.list("My edited tour", 0).unwrap().len(), 1);
        let fresh = ws.install_getting_started(package(), true).unwrap();
        assert_ne!(fresh, id);
        assert_eq!(ws.catalog().unwrap().collections.len(), 2);
        ws.delete(&fresh).unwrap();
        let status = ws.getting_started_status().unwrap();
        assert!(!status.pending);
        assert!(status.welcome_id.is_none());
        ws.restore_object(&fresh).unwrap();
        assert_eq!(ws.getting_started_status().unwrap().welcome_id, Some(fresh));
    }
    #[test]
    fn existing_workspace_does_not_auto_install_tour() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("old");
        let ws = Workspace::open(root.clone()).unwrap();
        ws.db.execute_batch("ALTER TABLE collections DROP COLUMN deleted_at; DROP TRIGGER objects_creation_date; DROP INDEX objects_library_created; DROP INDEX objects_library_updated; ALTER TABLE objects DROP COLUMN created_at; DROP TABLE getting_started; DROP TABLE mcq_progress; DROP TABLE mcq_attempts; DROP TABLE mcq_drafts; DROP TABLE card_deck; DROP TABLE notebook_origins; DROP TABLE unshared_references; ALTER TABLE collections DROP COLUMN position; DELETE FROM schema_migrations WHERE version>=5; PRAGMA user_version=4;").unwrap();
        drop(ws);
        let ws = Workspace::open(root).unwrap();
        assert!(!ws.getting_started_status().unwrap().pending);
        assert!(ws.getting_started_status().unwrap().welcome_id.is_none());
    }
}
