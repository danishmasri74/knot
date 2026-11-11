use crate::storage::{Object, Result, Workspace};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub notebooks: Vec<String>,
}
#[derive(Serialize)]
pub struct Catalog {
    pub collections: Vec<Collection>,
    pub favorites: Vec<String>,
}
#[derive(Serialize, Deserialize)]
pub struct Membership {
    pub collections: Vec<String>,
}
fn name(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty() || value.len() > 100 {
        return Err("Name must contain 1–100 bytes".into());
    }
    Ok(value)
}
impl Workspace {
    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<()> {
        self.db.query_row(
            "SELECT id FROM objects WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |_| Ok(()),
        )?;
        if favorite {
            self.db.execute(
                "INSERT OR IGNORE INTO favorites(object_id) VALUES(?1)",
                [id],
            )?;
        } else {
            self.db
                .execute("DELETE FROM favorites WHERE object_id=?1", [id])?;
        }
        Ok(())
    }

    pub fn catalog(&self) -> Result<Catalog> {
        let mut q = self
            .db
            .prepare("SELECT id,name FROM collections WHERE deleted_at IS NULL ORDER BY position,name COLLATE NOCASE,id")?;
        let mut collections = q
            .query_map([], |r| {
                Ok(Collection {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    notebooks: Vec::new(),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut memberships = self.db.prepare("SELECT collection_id,object_id FROM collection_objects JOIN objects ON objects.id=object_id WHERE objects.deleted_at IS NULL ORDER BY collection_id,object_id")?;
        let indices: std::collections::HashMap<_, _> = collections
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id.clone(), i))
            .collect();
        for row in
            memberships.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        {
            let (collection, object) = row?;
            if let Some(index) = indices.get(&collection) {
                collections[*index].notebooks.push(object);
            }
        }
        let favorites = self.db.prepare("SELECT object_id FROM favorites JOIN objects ON objects.id=object_id WHERE objects.deleted_at IS NULL ORDER BY object_id")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Catalog {
            collections,
            favorites,
        })
    }
    pub fn create_collection(&mut self, value: &str, object: Option<&str>) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let tx = self.db.transaction()?;
        tx.execute(
            "INSERT INTO collections(id,name,position) VALUES(?1,?2,(SELECT COALESCE(MAX(position),0)+1 FROM collections))",
            params![id, name(value)?],
        )?;
        if let Some(object) = object {
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM objects WHERE id=?1 AND deleted_at IS NULL)",
                [object],
                |r| r.get(0),
            )?;
            if !exists {
                return Err("Notebook no longer exists".into());
            }
            tx.execute(
                "INSERT INTO collection_objects VALUES(?1,?2)",
                params![object, id],
            )?;
        }
        tx.commit()?;
        Ok(id)
    }
    pub fn rename_collection(&self, id: &str, value: &str) -> Result<()> {
        if self.db.execute(
            "UPDATE collections SET name=?2 WHERE id=?1 AND deleted_at IS NULL",
            params![id, name(value)?],
        )? == 0
        {
            return Err("Collection no longer exists".into());
        }
        Ok(())
    }
    pub fn reorder_collections(&mut self, ids: Vec<String>) -> Result<()> {
        let tx = self.db.transaction()?;
        let count: usize = tx.query_row(
            "SELECT count(*) FROM collections WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        if ids.len() != count || unique.len() != count {
            return Err("Collections changed; please try again".into());
        }
        for (position, id) in ids.iter().enumerate() {
            if tx.execute(
                "UPDATE collections SET position=?2 WHERE id=?1 AND deleted_at IS NULL",
                params![id, position as i64],
            )? != 1
            {
                return Err("Collection no longer exists".into());
            }
        }
        tx.commit()?;
        Ok(())
    }
    pub fn delete_collection(&self, id: &str) -> Result<()> {
        self.db.execute(
            "UPDATE collections SET deleted_at=?2 WHERE id=?1 AND deleted_at IS NULL",
            params![id, crate::storage::now()],
        )?;
        Ok(())
    }
    pub fn membership(&self, id: &str) -> Result<Membership> {
        self.db.query_row(
            "SELECT id FROM objects WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |_| Ok(()),
        )?;
        let mut q = self.db.prepare("SELECT collection_id FROM collection_objects JOIN collections ON collections.id=collection_id WHERE object_id=?1 AND collections.deleted_at IS NULL ORDER BY collection_id")?;
        let collections = q
            .query_map([id], |r| r.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Membership { collections })
    }
    pub fn set_membership(&mut self, id: &str, value: &Membership) -> Result<()> {
        let tx = self.db.transaction()?;
        tx.query_row(
            "SELECT id FROM objects WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |_| Ok(()),
        )?;
        tx.execute("DELETE FROM collection_objects WHERE object_id=?1 AND collection_id IN (SELECT id FROM collections WHERE deleted_at IS NULL)", [id])?;
        for collection in &value.collections {
            tx.query_row(
                "SELECT id FROM collections WHERE id=?1 AND deleted_at IS NULL",
                [collection],
                |_| Ok(()),
            )?;
            tx.execute(
                "INSERT OR IGNORE INTO collection_objects VALUES(?1,?2)",
                params![id, collection],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn filtered_list(
        &self,
        search: &str,
        offset: i64,
        collection: Option<&str>,
    ) -> Result<Vec<Object>> {
        let mut q = self.db.prepare("SELECT id,title,kind,updated_at FROM objects WHERE deleted_at IS NULL AND instr(lower(title),lower(?1))>0 AND (?3 IS NULL OR EXISTS(SELECT 1 FROM collection_objects JOIN collections ON collections.id=collection_id WHERE collections.deleted_at IS NULL AND object_id=objects.id AND collection_id=?3)) ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?2")?;
        let rows = q.query_map(params![search, offset.max(0), collection], |r| {
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

#[derive(Serialize)]
pub struct LibraryRow {
    #[serde(flatten)]
    pub object: Object,
    pub created_at: Option<i64>,
}
#[derive(Serialize)]
pub struct LibraryPage {
    pub rows: Vec<LibraryRow>,
    pub total: i64,
}
impl Workspace {
    pub fn library_page(
        &self,
        search: &str,
        collection: Option<&str>,
        created: bool,
        offset: i64,
    ) -> Result<LibraryPage> {
        let condition = "deleted_at IS NULL AND instr(lower(title),lower(?1))>0 AND (?2 IS NULL OR (?2='' AND NOT EXISTS(SELECT 1 FROM collection_objects JOIN collections ON collections.id=collection_id WHERE collections.deleted_at IS NULL AND object_id=objects.id)) OR EXISTS(SELECT 1 FROM collection_objects JOIN collections ON collections.id=collection_id WHERE collections.deleted_at IS NULL AND object_id=objects.id AND collection_id=?2))";
        let total = self.db.query_row(
            &format!("SELECT count(*) FROM objects WHERE {condition}"),
            params![search, collection],
            |r| r.get(0),
        )?;
        let sort = if created { "created_at" } else { "updated_at" };
        let mut q = self.db.prepare(&format!("SELECT id,title,kind,updated_at,created_at FROM objects WHERE {condition} ORDER BY {sort} DESC,id LIMIT 100 OFFSET ?3"))?;
        let rows = q
            .query_map(params![search, collection, offset.max(0)], |r| {
                Ok(LibraryRow {
                    object: Object {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        kind: r.get(2)?,
                        updated_at: r.get(3)?,
                    },
                    created_at: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(LibraryPage { rows, total })
    }
}
