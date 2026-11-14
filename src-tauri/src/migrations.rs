use crate::{
    backup,
    storage::{Result, Workspace},
};
use rusqlite::Connection;
use std::{fs, path::Path};

pub const CURRENT_SCHEMA: i64 = 14;
const PREFIX: &str = "pre-migration-schema-";

fn verify_archive(path: &Path) -> Result<()> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path)?)?;
    if archive.len() > 100_000 {
        return Err("Archive exceeds the restore entry limit".into());
    }
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        total = total
            .checked_add(entry.size())
            .ok_or("Archive size overflow")?;
        if total > 20 * 1024 * 1024 * 1024u64 {
            return Err("Archive exceeds the 20 GiB restore limit".into());
        }
        std::io::copy(&mut entry, &mut std::io::sink())?;
    }
    Ok(())
}

fn validate_database(db: &Connection) -> Result<()> {
    let mut check = db.prepare("PRAGMA integrity_check")?;
    for row in check.query_map([], |r| r.get::<_, String>(0))? {
        if row? != "ok" {
            return Err("Migration refused: database integrity check failed".into());
        }
    }
    let violations: i64 =
        db.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })?;
    if violations != 0 {
        return Err("Migration refused: broken database relationships".into());
    }
    Ok(())
}

pub fn recovery_archives(root: &Path) -> Result<Vec<String>> {
    let directory = root.join("backups");
    if directory.canonicalize()?.parent() != Some(root.canonicalize()?.as_path()) {
        return Err("Migration recovery folder is outside the workspace".into());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(PREFIX) && name.ends_with(".knot") && entry.file_type()?.is_file() {
            paths.push(entry.path().display().to_string());
        }
    }
    paths.sort();
    Ok(paths)
}

/// Upgrade catalog schema only. Yjs bodies and reference IDs remain opaque bytes.
pub fn upgrade(ws: &Workspace, version: i64) -> Result<()> {
    if !(0..=CURRENT_SCHEMA).contains(&version) {
        return Err("Database is newer than this Knot version or has an unsupported schema".into());
    }
    if version == CURRENT_SCHEMA {
        return Ok(());
    }
    validate_database(&ws.db)?;
    if version == 0 {
        let tables: i64 = ws.db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )?;
        if tables != 0 {
            return Err(
                "Unversioned database contains data; refusing to initialize or overwrite it".into(),
            );
        }
    } else {
        let history = ws
            .db
            .prepare("SELECT version FROM schema_migrations ORDER BY version")?
            .query_map([], |r| r.get::<_, i64>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if history != (1..=version).collect::<Vec<_>>() {
            return Err(
                "Migration history does not match the database version; stored data was preserved"
                    .into(),
            );
        }
    }
    let recovery = if version > 0 {
        // Require a contained destination and healthy indexed assets before upgrading.
        recovery_archives(&ws.root)?;
        let mut assets = ws
            .db
            .prepare("SELECT DISTINCT sha256,size FROM attachments")?;
        for row in assets.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)))? {
            let (hash, size) = row?;
            if fs::metadata(ws.asset_path(&hash)?)?.len() != size {
                return Err(
                    "Migration refused: attachment size mismatch; recover a backup first".into(),
                );
            }
        }
        let path = ws
            .root
            .join("backups")
            .join(format!("{PREFIX}{version}-{}.knot", uuid::Uuid::new_v4()));
        backup::export(ws, &path).map_err(|e| format!("Migration stopped before changing schema: recovery archive could not be created: {e}"))?;
        // Read every entry to EOF to verify ZIP decompression and CRC before mutation.
        verify_archive(&path).map_err(|e| format!("Migration stopped before changing schema: recovery archive verification failed at {}: {e}", path.display()))?;
        Some(path)
    } else {
        None
    };
    let outcome = (|| -> Result<()> {
        let tx = ws.db.unchecked_transaction()?;
        if version == 0 {
            tx.execute_batch(include_str!("../migrations/001_initial.sql"))?;
        }
        if version < 2 {
            tx.execute_batch(include_str!("../migrations/002_organization.sql"))?;
        }
        if version < 3 {
            tx.execute_batch(include_str!("../migrations/003_collections.sql"))?;
        }
        if version < 4 {
            tx.execute_batch(include_str!("../migrations/004_favorites.sql"))?;
        }
        if version < 5 {
            tx.execute_batch(include_str!("../migrations/005_getting_started.sql"))?;
        }
        if version < 6 {
            tx.execute_batch(include_str!("../migrations/006_collection_order.sql"))?;
        }
        if version < 7 {
            tx.execute_batch(include_str!("../migrations/007_library.sql"))?;
        }
        if version < 8 {
            tx.execute_batch(include_str!("../migrations/008_collection_trash.sql"))?;
        }
        if version < 9 {
            tx.execute_batch(include_str!("../migrations/009_card_deck.sql"))?;
        }
        if version < 10 {
            tx.execute_batch(include_str!("../migrations/010_mcq.sql"))?;
        }
        if version < 11 {
            tx.execute_batch(include_str!("../migrations/011_sharing.sql"))?;
        }
        if version < 12 {
            tx.execute_batch(include_str!("../migrations/012_ai_chats.sql"))?;
        }
        if version < 13 {
            tx.execute_batch(include_str!("../migrations/013_video_transcripts.sql"))?;
        }
        tx.execute_batch(include_str!("../migrations/014_media_cards.sql"))?;
        if version == 0 {
            tx.execute("UPDATE getting_started SET pending=1", [])?;
        }
        tx.pragma_update(None, "user_version", CURRENT_SCHEMA)?;
        validate_database(&tx)?;
        tx.commit()?;
        Ok(())
    })();
    outcome.map_err(|error| match recovery {
        Some(path) => format!("Migration failed; schema changes rolled back. Pre-migration recovery archive: {}. {error}", path.display()).into(),
        None => format!("Workspace initialization failed and was rolled back: {error}").into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::hash_file;
    use std::io::Read;

    #[test]
    fn version_three_preserves_collections_when_adding_favorites() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("v3");
        let db = legacy(&root);
        db.execute_batch(include_str!("../migrations/002_organization.sql"))
            .unwrap();
        db.execute_batch(include_str!("../migrations/003_collections.sql"))
            .unwrap();
        db.pragma_update(None, "user_version", 3).unwrap();
        db.execute_batch("INSERT INTO collections VALUES('keep','Keep'); INSERT INTO collection_objects VALUES('board','keep');").unwrap();
        drop(db);
        let ws = Workspace::open(root).unwrap();
        assert_eq!(version(&ws.db), CURRENT_SCHEMA);
        assert_eq!(ws.membership("board").unwrap().collections, vec!["keep"]);
        assert!(ws.catalog().unwrap().favorites.is_empty());
        ws.set_favorite("board", true).unwrap();
        assert_eq!(ws.catalog().unwrap().favorites, vec!["board"]);
    }

    fn legacy(root: &Path) -> Connection {
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join("workspace.json"),
            br#"{"id":"stable-workspace","format_version":1}"#,
        )
        .unwrap();
        let db = Connection::open(root.join("knot.db")).unwrap();
        db.execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        db.execute_batch("PRAGMA user_version=1; INSERT INTO objects VALUES('source','Shared source','note',7,9),('board','Board','whiteboard',8,NULL); INSERT INTO documents VALUES('source',x'0102',x'0304',5),('board',x'0506',x'0708',6);").unwrap();
        db
    }

    fn version(db: &Connection) -> i64 {
        db.pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn version_two_groups_migrate_and_old_backup_restores() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("legacy-groups");
        let db = legacy(&root);
        db.execute_batch(include_str!("../migrations/002_organization.sql"))
            .unwrap();
        db.execute_batch(
            "PRAGMA user_version=2;
          INSERT INTO folders VALUES('f','Research'),('empty','Empty');
          INSERT INTO tags VALUES('t','research'),('trash','Archived'),('unused','Unused');
          UPDATE objects SET folder_id='f' WHERE id='board';
          INSERT INTO object_tags VALUES('source','t'),('source','trash');",
        )
        .unwrap();
        drop(db);
        let ws = Workspace::open(root.clone()).unwrap();
        assert_eq!(version(&ws.db), CURRENT_SCHEMA);
        assert_eq!(ws.catalog().unwrap().collections.len(), 2);
        assert_eq!(ws.filtered_list("", 0, Some("folder:f")).unwrap().len(), 1);
        ws.restore_object("source").unwrap();
        assert_eq!(ws.membership("source").unwrap().collections.len(), 2);
        assert_eq!(ws.filtered_list("", 0, Some("folder:f")).unwrap().len(), 2);
        assert_eq!(ws.load("source").unwrap().unwrap().document, vec![3, 4]);
        assert_eq!(ws.db.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('folders','tags','object_tags','objects_folder')", [], |r| r.get::<_,i64>(0)).unwrap(), 0);
        assert_eq!(
            ws.db
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('objects') WHERE name='folder_id'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let archives = recovery_archives(&root).unwrap();
        let restored =
            Workspace::open(backup::restore(Path::new(&archives[0]), tmp.path()).unwrap()).unwrap();
        restored.restore_object("source").unwrap();
        assert_eq!(restored.membership("source").unwrap().collections.len(), 2);
        assert_eq!(restored.catalog().unwrap().collections.len(), 2);
        validate_database(&restored.db).unwrap();
    }

    #[test]
    fn migration_retains_recoverable_archive_and_all_original_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("legacy");
        let db = legacy(&root);
        let bytes = b"shared and trashed asset";
        let seed = tmp.path().join("seed");
        fs::write(&seed, bytes).unwrap();
        let hash = hash_file(&seed).unwrap();
        let asset = root.join("assets").join(&hash[..2]).join(&hash);
        fs::create_dir_all(asset.parent().unwrap()).unwrap();
        fs::write(&asset, bytes).unwrap();
        db.execute(
            "INSERT INTO attachments VALUES('asset',?1,'photo','image/png',?2)",
            rusqlite::params![hash, bytes.len()],
        )
        .unwrap();
        db.execute_batch(
            "INSERT INTO object_attachments VALUES('source','asset'),('board','asset');",
        )
        .unwrap();
        let manifest = fs::read(root.join("workspace.json")).unwrap();
        drop(db);
        let ws = Workspace::open(root.clone()).unwrap();
        assert_eq!(version(&ws.db), CURRENT_SCHEMA);
        assert_eq!(ws.load("source").unwrap().unwrap().document, vec![3, 4]);
        assert_eq!(ws.load("board").unwrap().unwrap().document, vec![7, 8]);
        assert_eq!(ws.trash("", 0).unwrap()[0].object.id, "source");
        assert_eq!(fs::read(&asset).unwrap(), bytes);
        assert_eq!(fs::read(root.join("workspace.json")).unwrap(), manifest);
        let archives = recovery_archives(&root).unwrap();
        assert_eq!(archives.len(), 1);
        let mut zip = zip::ZipArchive::new(fs::File::open(&archives[0]).unwrap()).unwrap();
        let old = tmp.path().join("old.db");
        std::io::copy(
            &mut zip.by_name("knot.db").unwrap(),
            &mut fs::File::create(&old).unwrap(),
        )
        .unwrap();
        let old = Connection::open(old).unwrap();
        assert_eq!(version(&old), 1);
        for table in ["documents", "attachments", "object_attachments"] {
            // SQL row values, including binary snapshots and revisions, are identical.
            fn rows(db: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
                let mut stmt = db
                    .prepare(&format!("SELECT * FROM {table} ORDER BY 1,2"))
                    .unwrap();
                let columns = stmt.column_count();
                stmt.query_map([], |r| (0..columns).map(|i| r.get(i)).collect())
                    .unwrap()
                    .collect::<std::result::Result<_, _>>()
                    .unwrap()
            }
            assert_eq!(rows(&ws.db, table), rows(&old, table));
        }
        let mut archived_asset = Vec::new();
        zip.by_name(&format!("assets/{}/{hash}", &hash[..2]))
            .unwrap()
            .read_to_end(&mut archived_asset)
            .unwrap();
        assert_eq!(archived_asset, bytes);
        drop(zip);
        drop(ws);
        let ws = Workspace::open(root.clone()).unwrap();
        assert_eq!(recovery_archives(&root).unwrap(), archives);
        let recovered = backup::restore(Path::new(&archives[0]), tmp.path()).unwrap();
        let recovered = Workspace::open(recovered).unwrap();
        assert_eq!(
            recovered.load("board").unwrap().unwrap().document,
            vec![7, 8]
        );
        assert_eq!(recovered.get_blob("asset").unwrap(), bytes);
        assert_eq!(recovered.trash("", 0).unwrap()[0].object.id, "source");
        assert_eq!(ws.integrity().unwrap().migration_backups, archives);
    }

    #[test]
    fn migration_failure_rolls_back_schema_and_retains_archive_for_retry() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("legacy");
        let db = legacy(&root);
        db.execute_batch("CREATE TRIGGER reject_migration BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT,'injected migration failure'); END;").unwrap();
        drop(db);
        let error = Workspace::open(root.clone()).err().unwrap().to_string();
        assert!(error.contains("rolled back") && error.contains("Pre-migration recovery archive"));
        let archives = recovery_archives(&root).unwrap();
        assert_eq!(archives.len(), 1);
        let db = Connection::open(root.join("knot.db")).unwrap();
        assert_eq!(version(&db), 1);
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='folders'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT document_state FROM documents WHERE object_id='source'",
                [],
                |r| r.get::<_, Vec<u8>>(0)
            )
            .unwrap(),
            vec![3, 4]
        );
        db.execute_batch("DROP TRIGGER reject_migration").unwrap();
        drop(db);
        let ws = Workspace::open(root.clone()).unwrap();
        assert_eq!(version(&ws.db), CURRENT_SCHEMA);
        assert_eq!(recovery_archives(&root).unwrap().len(), 2);
        assert!(Path::new(&archives[0]).is_file());
    }

    #[test]
    fn migration_refuses_unbackable_assets_and_invalid_history() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("legacy");
        let db = legacy(&root);
        db.execute(
            "INSERT INTO attachments VALUES('missing',?1,'missing','image/png',3)",
            ["a".repeat(64)],
        )
        .unwrap();
        drop(db);
        assert!(Workspace::open(root.clone()).is_err());
        let db = Connection::open(root.join("knot.db")).unwrap();
        assert_eq!(version(&db), 1);
        assert!(recovery_archives(&root).unwrap().is_empty());
        drop(db);
        let bad_asset = root.join("assets/aa").join("a".repeat(64));
        fs::create_dir_all(bad_asset.parent().unwrap()).unwrap();
        fs::write(bad_asset, b"bad").unwrap();
        assert!(Workspace::open(root.clone())
            .err()
            .unwrap()
            .to_string()
            .contains("recovery archive could not be created"));
        assert!(recovery_archives(&root).unwrap().is_empty());
        let db = Connection::open(root.join("knot.db")).unwrap();
        assert_eq!(version(&db), 1);
        db.execute_batch("DELETE FROM attachments; DELETE FROM schema_migrations;")
            .unwrap();
        drop(db);
        assert!(Workspace::open(root.clone())
            .err()
            .unwrap()
            .to_string()
            .contains("history"));
        assert!(recovery_archives(&root).unwrap().is_empty());
    }

    #[test]
    fn unknown_and_unversioned_databases_are_not_initialized() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("legacy");
        let db = legacy(&root);
        db.pragma_update(None, "user_version", 99).unwrap();
        drop(db);
        let original = fs::read(root.join("knot.db")).unwrap();
        assert!(Workspace::open(root.clone()).is_err());
        assert_eq!(fs::read(root.join("knot.db")).unwrap(), original);
        let db = Connection::open(root.join("knot.db")).unwrap();
        db.pragma_update(None, "user_version", 0).unwrap();
        drop(db);
        assert!(Workspace::open(root.clone())
            .err()
            .unwrap()
            .to_string()
            .contains("Unversioned"));
        let db = Connection::open(root.join("knot.db")).unwrap();
        assert_eq!(version(&db), 0);
        assert_eq!(
            db.query_row("SELECT count(*) FROM documents", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn migration_refuses_broken_relationships_and_unavailable_archive_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let fresh = Workspace::open(tmp.path().join("fresh")).unwrap();
        assert_eq!(version(&fresh.db), CURRENT_SCHEMA);
        assert!(recovery_archives(&fresh.root).unwrap().is_empty());
        let root = tmp.path().join("legacy");
        let db = legacy(&root);
        db.execute_batch(
            "PRAGMA foreign_keys=OFF; INSERT INTO object_attachments VALUES('source','absent');",
        )
        .unwrap();
        drop(db);
        assert!(Workspace::open(root.clone())
            .err()
            .unwrap()
            .to_string()
            .contains("broken database relationships"));
        let db = Connection::open(root.join("knot.db")).unwrap();
        assert_eq!(version(&db), 1);
        db.execute_batch("DELETE FROM object_attachments").unwrap();
        drop(db);
        // Replace only the known empty fixture directory with a blocking file.
        fs::remove_dir(root.join("backups")).unwrap();
        fs::write(root.join("backups"), b"retained blocker").unwrap();
        assert!(Workspace::open(root.clone()).is_err());
        let db = Connection::open(root.join("knot.db")).unwrap();
        assert_eq!(version(&db), 1);
        assert_eq!(fs::read(root.join("backups")).unwrap(), b"retained blocker");
    }
}
