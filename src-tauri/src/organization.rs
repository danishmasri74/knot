use crate::storage::{now, Object, Result, Workspace};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct Label {
    pub id: String,
    pub name: String,
}
#[derive(Serialize)]
pub struct Catalog {
    pub folders: Vec<Label>,
    pub tags: Vec<Label>,
}
#[derive(Serialize, Deserialize)]
pub struct Organization {
    pub folder: Option<String>,
    pub tags: Vec<String>,
}
fn table(kind: &str) -> Result<&'static str> {
    match kind {
        "folder" => Ok("folders"),
        "tag" => Ok("tags"),
        _ => Err("Unknown organization type".into()),
    }
}
fn name(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty() || value.len() > 100 {
        return Err("Name must contain 1–100 bytes".into());
    }
    Ok(value)
}
impl Workspace {
    pub fn catalog(&self) -> Result<Catalog> {
        let read = |kind| -> Result<Vec<Label>> {
            let mut q = self.db.prepare(&format!(
                "SELECT id,name FROM {} ORDER BY name COLLATE NOCASE,id",
                table(kind)?
            ))?;
            let rows = q.query_map([], |r| {
                Ok(Label {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })?;
            Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
        };
        Ok(Catalog {
            folders: read("folder")?,
            tags: read("tag")?,
        })
    }
    pub fn create_label(&self, kind: &str, value: &str) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.db.execute(
            &format!("INSERT INTO {}(id,name) VALUES(?1,?2)", table(kind)?),
            params![id, name(value)?],
        )?;
        Ok(id)
    }
    pub fn rename_label(&self, kind: &str, id: &str, value: &str) -> Result<()> {
        if self.db.execute(
            &format!("UPDATE {} SET name=?2 WHERE id=?1", table(kind)?),
            params![id, name(value)?],
        )? == 0
        {
            return Err("Folder or tag no longer exists".into());
        }
        Ok(())
    }
    pub fn delete_label(&self, kind: &str, id: &str) -> Result<()> {
        self.db
            .execute(&format!("DELETE FROM {} WHERE id=?1", table(kind)?), [id])?;
        Ok(())
    }
    pub fn organization(&self, id: &str) -> Result<Organization> {
        let folder = self.db.query_row(
            "SELECT folder_id FROM objects WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )?;
        let mut q = self
            .db
            .prepare("SELECT tag_id FROM object_tags WHERE object_id=?1 ORDER BY tag_id")?;
        let tags = q
            .query_map([id], |r| r.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Organization { folder, tags })
    }
    pub fn organize(&mut self, id: &str, value: &Organization) -> Result<()> {
        if value.tags.len() > 100 {
            return Err("A document can have at most 100 tags".into());
        }
        let tx = self.db.transaction()?;
        if tx.execute(
            "UPDATE objects SET folder_id=?2,updated_at=?3 WHERE id=?1 AND deleted_at IS NULL",
            params![id, value.folder, now()],
        )? == 0
        {
            return Err("Document no longer exists".into());
        }
        tx.execute("DELETE FROM object_tags WHERE object_id=?1", [id])?;
        for tag in &value.tags {
            tx.execute(
                "INSERT OR IGNORE INTO object_tags VALUES(?1,?2)",
                params![id, tag],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    // None means all folders; an empty folder ID means unfiled documents.
    pub fn filtered_list(
        &self,
        search: &str,
        offset: i64,
        folder: Option<&str>,
        tag: Option<&str>,
    ) -> Result<Vec<Object>> {
        let mut q = self.db.prepare("SELECT id,title,kind,updated_at FROM objects WHERE deleted_at IS NULL AND instr(lower(title),lower(?1))>0 AND (?3 IS NULL OR folder_id=?3 OR (?3='' AND folder_id IS NULL)) AND (?4 IS NULL OR EXISTS(SELECT 1 FROM object_tags WHERE object_id=objects.id AND tag_id=?4)) ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?2")?;
        let rows = q.query_map(params![search, offset.max(0), folder, tag], |r| {
            Ok(Object {
                id: r.get(0)?,
                title: r.get(1)?,
                kind: r.get(2)?,
                updated_at: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
}
