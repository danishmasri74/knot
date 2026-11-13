use super::{
    backup,
    storage::{Snapshot, Workspace},
};
#[test]
fn restart_and_isolation() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("workspace");
    let mut w = Workspace::open(path.clone()).unwrap();
    let a = w.create("note").unwrap();
    let b = w.create("whiteboard").unwrap();
    w.save(
        &a,
        &Snapshot {
            title: None,
            collection: vec![1, 2],
            document: vec![3, 4],
        },
    )
    .unwrap();
    w.save(
        &b,
        &Snapshot {
            title: None,
            collection: vec![5],
            document: vec![6],
        },
    )
    .unwrap();
    drop(w);
    let w = Workspace::open(path).unwrap();
    assert_eq!(w.load(&a).unwrap().unwrap().document, vec![3, 4]);
    assert_eq!(w.load(&b).unwrap().unwrap().document, vec![6]);
    assert_eq!(w.list("", 0).unwrap().len(), 2);
}
#[test]
fn attachments_backup_restore() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let id = w.create("note").unwrap();
    w.save(
        &id,
        &Snapshot {
            title: None,
            collection: vec![1],
            document: vec![2],
        },
    )
    .unwrap();
    for key in ["first", "duplicate"] {
        w.put_blob(&id, key, b"sample file", "sample.pdf", "application/pdf")
            .unwrap();
    }
    let count: i64 =
        w.db.query_row("SELECT count(DISTINCT sha256) FROM attachments", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(w.get_blob("first").unwrap(), b"sample file");
    let archive = tmp.path().join("backup.knot");
    backup::export(&w, &archive).unwrap();
    let root = backup::restore(&archive, tmp.path()).unwrap();
    let restored = Workspace::open(root).unwrap();
    assert_eq!(restored.get_blob("duplicate").unwrap(), b"sample file");
    assert_eq!(restored.load(&id).unwrap().unwrap().document, vec![2]);
}
#[test]
fn reject_unsafe_and_corrupt_data() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    assert!(w.asset_path("../../secret").is_err());
    let id = w.create("note").unwrap();
    w.put_blob(&id, "x", b"hello", "x", "text/plain").unwrap();
    let hash: String =
        w.db.query_row("SELECT sha256 FROM attachments WHERE id='x'", [], |r| {
            r.get(0)
        })
        .unwrap();
    std::fs::write(w.asset_path(&hash).unwrap(), b"broken").unwrap();
    assert!(w.get_blob("x").is_err());
    assert!(backup::export(&w, &tmp.path().join("bad.knot")).is_err());
    w.delete(&id).unwrap();
    assert!(w.list("", 0).unwrap().is_empty());
    assert!(w
        .save(
            &id,
            &Snapshot {
                title: None,
                collection: vec![1],
                document: vec![2]
            }
        )
        .is_err());
}
#[test]
fn migrations_reopen_without_reset() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("workspace");
    let w = Workspace::open(path.clone()).unwrap();
    let id = w.create("note").unwrap();
    w.rename(&id, "Persistent title").unwrap();
    drop(w);
    let w = Workspace::open(path).unwrap();
    assert_eq!(w.list("persistent", 0).unwrap()[0].id, id);
    let v: i64 =
        w.db.pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
    assert_eq!(v, crate::migrations::CURRENT_SCHEMA);
}
#[test]
fn reject_zip_traversal() {
    use std::io::Write;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("evil.knot");
    let mut z = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    z.start_file("../escape", zip::write::SimpleFileOptions::default())
        .unwrap();
    z.write_all(b"unsafe").unwrap();
    z.finish().unwrap();
    assert!(backup::restore(&path, tmp.path()).is_err());
    assert!(!tmp.path().join("escape").exists());
}

#[test]
fn workspace_lock_prevents_competing_writers() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("locked");
    let first = Workspace::open(path.clone()).unwrap();
    assert!(Workspace::open(path.clone()).is_err());
    drop(first);
    assert!(Workspace::open(path).is_ok());
}

// Opt-in integration check against a workspace created through the native editor.
// Never changes document content; writes the archive and restored workspace in a temp directory.
#[test]
#[ignore = "Set KNOT_TEST_WORKSPACE to a closed native test workspace"]
fn native_workspace_backup_roundtrip() {
    let path = std::env::var("KNOT_TEST_WORKSPACE").expect("KNOT_TEST_WORKSPACE required");
    let source = Workspace::open(path.into()).unwrap();
    let objects = source.list("", 0).unwrap();
    assert!(!objects.is_empty());
    let temp = tempfile::tempdir().unwrap();
    let archive = temp.path().join("native.knot");
    backup::export(&source, &archive).unwrap();
    let restored = Workspace::open(backup::restore(&archive, temp.path()).unwrap()).unwrap();
    for object in objects {
        let before = source.load(&object.id).unwrap().unwrap();
        let after = restored.load(&object.id).unwrap().unwrap();
        assert_eq!(before.collection, after.collection);
        assert_eq!(before.document, after.document);
        for id in source.blobs(&object.id).unwrap() {
            assert_eq!(
                source.get_blob(&id).unwrap(),
                restored.get_blob(&id).unwrap()
            );
        }
    }
}

#[test]
fn snapshot_and_title_commit_together() {
    let temp = tempfile::tempdir().unwrap();
    let mut workspace = Workspace::open(temp.path().join("workspace")).unwrap();
    let id = workspace.create("note").unwrap();
    workspace
        .save(
            &id,
            &Snapshot {
                collection: vec![1],
                document: vec![2],
                title: Some("Edited in the page".into()),
            },
        )
        .unwrap();
    assert_eq!(workspace.list("Edited in", 0).unwrap()[0].id, id);
    assert_eq!(workspace.load(&id).unwrap().unwrap().document, vec![2]);
}

#[test]
fn integrity_audit_is_read_only() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("audit")).unwrap();
    let id = w.create("note").unwrap();
    w.put_blob(&id, "missing", b"missing", "m.png", "image/png")
        .unwrap();
    w.put_blob(&id, "corrupt", b"original", "c.pdf", "application/pdf")
        .unwrap();
    let missing: String =
        w.db.query_row(
            "SELECT sha256 FROM attachments WHERE id='missing'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let corrupt: String =
        w.db.query_row(
            "SELECT sha256 FROM attachments WHERE id='corrupt'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    std::fs::remove_file(w.asset_path(&missing).unwrap()).unwrap();
    std::fs::write(w.asset_path(&corrupt).unwrap(), b"changed").unwrap();
    let orphan = w.root.join("assets/aa/interrupted.tmp");
    std::fs::create_dir_all(orphan.parent().unwrap()).unwrap();
    std::fs::write(&orphan, b"unfinished").unwrap();
    let report = w.integrity().unwrap();
    assert_eq!(report.missing, vec![missing]);
    assert_eq!(report.corrupt, vec![corrupt]);
    assert_eq!(report.orphan_files.len(), 1);
    assert!(orphan.exists());
}

#[test]
fn sqlite_failed_write_keeps_previous_snapshot() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("readonly")).unwrap();
    let id = w.create("note").unwrap();
    let saved = Snapshot {
        collection: vec![1],
        document: vec![2],
        title: Some("Saved".into()),
    };
    w.save(&id, &saved).unwrap();
    w.db.execute_batch("PRAGMA query_only=ON").unwrap();
    assert!(w
        .save(
            &id,
            &Snapshot {
                collection: vec![3],
                document: vec![4],
                title: Some("Unsaved".into())
            }
        )
        .is_err());
    assert_eq!(w.load(&id).unwrap().unwrap().document, vec![2]);
    assert_eq!(w.list("Saved", 0).unwrap()[0].title, "Saved");
    w.db.execute_batch("PRAGMA query_only=OFF").unwrap();
    w.save(&id, &saved).unwrap();
}

#[test]
fn invalid_manifest_and_database_are_not_reset() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("bad");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("workspace.json"), b"invalid").unwrap();
    assert!(Workspace::open(root.clone()).is_err());
    assert_eq!(
        std::fs::read(root.join("workspace.json")).unwrap(),
        b"invalid"
    );
    std::fs::write(
        root.join("workspace.json"),
        br#"{"id":"test","format_version":1}"#,
    )
    .unwrap();
    std::fs::write(root.join("knot.db"), b"damaged sqlite").unwrap();
    assert!(Workspace::open(root.clone()).is_err());
    assert_eq!(
        std::fs::read(root.join("knot.db")).unwrap(),
        b"damaged sqlite"
    );
}

#[test]
#[ignore = "Repeatable metadata benchmark; run with --ignored --nocapture"]
fn library_10000_benchmark() {
    let temp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(temp.path().join("benchmark")).unwrap();
    let tx = w.db.transaction().unwrap();
    for i in 0..10000 {
        tx.execute(
            "INSERT INTO objects(id,title,kind,updated_at) VALUES(?1,?2,'note',?3)",
            rusqlite::params![format!("id-{i}"), format!("Research note {i}"), i],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    let started = std::time::Instant::now();
    let rows = w.list("", 0).unwrap();
    let first = started.elapsed();
    assert_eq!(rows.len(), 100);
    let started = std::time::Instant::now();
    let matches = w.list("999", 0).unwrap();
    assert!(!matches.is_empty());
    println!(
        "10,000 objects: first page {:?}; substring search {:?}",
        first,
        started.elapsed()
    );
}

#[test]
fn missing_database_does_not_silently_initialize() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("missing-db");
    let workspace = Workspace::open(root.clone()).unwrap();
    drop(workspace);
    std::fs::remove_file(root.join("knot.db")).unwrap();
    assert!(Workspace::open(root.clone()).is_err());
    assert!(!root.join("knot.db").exists());
}

#[test]
fn collections_survive_reopen_backup_and_deletion() {
    use crate::collections::Membership;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("workspace");
    let mut w = Workspace::open(path.clone()).unwrap();
    let id = w.create("note").unwrap();
    let first = w.create_collection(" Research ", Some(&id)).unwrap();
    let second = w.create_collection("Important", None).unwrap();
    w.set_membership(
        &id,
        &Membership {
            collections: vec![first.clone(), second.clone()],
        },
    )
    .unwrap();
    w.save(
        &id,
        &Snapshot {
            title: Some("Research note".into()),
            collection: vec![1],
            document: vec![2],
        },
    )
    .unwrap();
    drop(w);
    let w = Workspace::open(path).unwrap();
    assert_eq!(w.membership(&id).unwrap().collections.len(), 2);
    assert_eq!(
        w.filtered_list("research", 0, Some(&first)).unwrap().len(),
        1
    );
    let archive = tmp.path().join("collections.knot");
    backup::export(&w, &archive).unwrap();
    let restored = Workspace::open(backup::restore(&archive, tmp.path()).unwrap()).unwrap();
    assert_eq!(restored.membership(&id).unwrap().collections.len(), 2);
    restored.rename_collection(&first, "Projects").unwrap();
    restored.delete_collection(&first).unwrap();
    assert_eq!(
        restored.membership(&id).unwrap().collections,
        vec![second.clone()]
    );
    restored.delete_collection(&second).unwrap();
    assert!(restored.membership(&id).unwrap().collections.is_empty());
    assert_eq!(restored.list("", 0).unwrap().len(), 1);
    assert_eq!(restored.load(&id).unwrap().unwrap().document, vec![2]);
}

#[test]
fn invalid_collection_changes_roll_back() {
    use crate::collections::Membership;
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let id = w.create("note").unwrap();
    let collection = w.create_collection("Work", Some(&id)).unwrap();
    assert!(w.create_collection("work", None).is_err());
    assert!(w.create_collection("  ", None).is_err());
    assert!(w.create_collection(&"x".repeat(101), None).is_err());
    assert!(w.create_collection("Orphan", Some("missing")).is_err());
    assert_eq!(w.catalog().unwrap().collections.len(), 1);
    assert!(w
        .set_membership(
            &id,
            &Membership {
                collections: vec!["missing".into()]
            }
        )
        .is_err());
    assert_eq!(
        w.membership(&id).unwrap().collections,
        vec![collection.clone()]
    );
    w.set_membership(
        &id,
        &Membership {
            collections: vec![collection.clone(), collection],
        },
    )
    .unwrap();
    assert_eq!(w.membership(&id).unwrap().collections.len(), 1);
    w.delete(&id).unwrap();
    assert!(w
        .set_membership(
            &id,
            &Membership {
                collections: vec![]
            }
        )
        .is_err());
    assert!(w.filtered_list("", 0, None).unwrap().is_empty());
}

#[test]
fn version_one_workspace_and_backup_migrate_without_losing_content() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("legacy");
    std::fs::create_dir(&path).unwrap();
    std::fs::write(
        path.join("workspace.json"),
        r#"{"id":"legacy","format_version":1}"#,
    )
    .unwrap();
    let db = rusqlite::Connection::open(path.join("knot.db")).unwrap();
    db.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    db.execute_batch("PRAGMA user_version=1; INSERT INTO objects VALUES('legacy','Keep me','note',1,NULL); INSERT INTO documents VALUES('legacy',x'01',x'02',1);").unwrap();
    drop(db);
    // Restore an actual old-format archive to exercise the upgrade path too.
    let archive = tmp.path().join("legacy.knot");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    for file in ["workspace.json", "knot.db"] {
        zip.start_file(file, zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::copy(&mut std::fs::File::open(path.join(file)).unwrap(), &mut zip).unwrap();
    }
    zip.finish().unwrap();
    let restored = Workspace::open(backup::restore(&archive, tmp.path()).unwrap()).unwrap();
    assert_eq!(restored.load("legacy").unwrap().unwrap().document, vec![2]);
    let w = Workspace::open(path).unwrap();
    assert_eq!(w.list("Keep", 0).unwrap()[0].id, "legacy");
    assert_eq!(w.load("legacy").unwrap().unwrap().collection, vec![1]);
    assert!(w.membership("legacy").unwrap().collections.is_empty());
    assert!(w.catalog().unwrap().collections.is_empty());
}

#[test]
fn collection_filters_paginate_and_combine_with_search() {
    use crate::collections::Membership;
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let folder = w.create_collection("Work", None).unwrap();
    let tag = w.create_collection("Read", None).unwrap();
    for n in 0..105 {
        let id = w.create("note").unwrap();
        w.rename(&id, &format!("Match {n}")).unwrap();
        w.set_membership(
            &id,
            &Membership {
                collections: vec![folder.clone(), tag.clone()],
            },
        )
        .unwrap();
    }
    w.create("note").unwrap();
    let a = w.filtered_list("Match", 0, Some(&folder)).unwrap();
    let b = w.filtered_list("Match", 100, Some(&folder)).unwrap();
    assert_eq!(a.len(), 100);
    assert_eq!(b.len(), 5);
    assert!(a.iter().all(|x| b.iter().all(|y| x.id != y.id)));
    assert_eq!(w.filtered_list("", 0, None).unwrap().len(), 100);
    assert!(w
        .filtered_list("absent", 0, Some(&folder))
        .unwrap()
        .is_empty());
}

#[test]
fn shared_document_batch_is_atomic_and_retained_in_backup() {
    use crate::storage::DocumentWrite;
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let board = w.create("whiteboard").unwrap();
    let note = "native-created-note".to_string();
    let write = |id: &str, create, bytes| DocumentWrite {
        id: id.into(),
        create,
        snapshot: Snapshot {
            title: Some(id.into()),
            collection: vec![1],
            document: bytes,
        },
    };
    w.save_documents(&[write(&note, true, vec![3]), write(&board, false, vec![])])
        .unwrap_err();
    assert!(w.load(&note).unwrap().is_none());
    assert_eq!(w.list("", 0).unwrap().len(), 1);
    w.save_documents(&[write(&note, true, vec![3]), write(&board, false, vec![4])])
        .unwrap();
    w.db.execute_batch("CREATE TRIGGER reject_board BEFORE UPDATE ON documents WHEN NEW.object_id != 'native-created-note' BEGIN SELECT RAISE(FAIL, 'disk failure'); END;").unwrap();
    w.save_documents(&[write(&note, false, vec![5]), write(&board, false, vec![6])])
        .unwrap_err();
    assert_eq!(w.load(&note).unwrap().unwrap().document, vec![3]);
    assert_eq!(w.load(&board).unwrap().unwrap().document, vec![4]);
    w.db.execute_batch("DROP TRIGGER reject_board;").unwrap();
    w.save_documents(&[write(&note, false, vec![5]), write(&board, false, vec![6])])
        .unwrap();
    w.delete(&note).unwrap();
    w.save_documents(&[write(&note, true, vec![7])])
        .unwrap_err();
    assert_eq!(w.load(&note).unwrap().unwrap().document, vec![5]);
    let archive = tmp.path().join("shared.knot");
    backup::export(&w, &archive).unwrap();
    let root = backup::restore(&archive, tmp.path()).unwrap();
    let restored = Workspace::open(root).unwrap();
    assert_eq!(restored.load(&note).unwrap().unwrap().document, vec![5]);
    assert_eq!(restored.load(&board).unwrap().unwrap().document, vec![6]);
    assert_eq!(restored.list("", 0).unwrap().len(), 1);
}

#[test]
fn trash_restore_preserves_identity_and_data() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("workspace");
    let mut w = Workspace::open(root.clone()).unwrap();
    let id = w.create("note").unwrap();
    w.save(
        &id,
        &Snapshot {
            title: Some("Recovered note".into()),
            collection: vec![1, 2],
            document: vec![3, 4],
        },
    )
    .unwrap();
    w.put_blob(&id, "asset", b"retained", "file", "text/plain")
        .unwrap();
    let folder = w.create_collection("Folder", None).unwrap();
    let tag = w.create_collection("Tag", None).unwrap();
    w.set_membership(
        &id,
        &super::collections::Membership {
            collections: vec![folder.clone(), tag.clone()],
        },
    )
    .unwrap();
    let updated = w.list("", 0).unwrap()[0].updated_at;
    w.delete(&id).unwrap();
    assert!(w.list("", 0).unwrap().is_empty());
    assert_eq!(w.trash("RECOVERED", 0).unwrap()[0].object.id, id);
    assert!(w.trash("absent", 0).unwrap().is_empty());
    assert!(w.trash("", -1).is_err());
    w.db.execute_batch("CREATE TRIGGER reject_restore BEFORE UPDATE ON objects BEGIN SELECT RAISE(FAIL,'failure'); END;").unwrap();
    assert!(w.restore_object(&id).is_err());
    assert_eq!(w.trash("", 0).unwrap().len(), 1);
    w.db.execute_batch("DROP TRIGGER reject_restore;").unwrap();
    let archive = tmp.path().join("trash.knot");
    backup::export(&w, &archive).unwrap();
    let restored_root = backup::restore(&archive, tmp.path()).unwrap();
    let restored = Workspace::open(restored_root).unwrap();
    restored.restore_object(&id).unwrap();
    assert_eq!(restored.load(&id).unwrap().unwrap().document, vec![3, 4]);
    drop(w);
    let w = Workspace::open(root).unwrap();
    w.restore_object(&id).unwrap();
    assert!(w.restore_object(&id).is_err());
    assert!(w.restore_object("missing").is_err());
    assert!(w.trash("", 0).unwrap().is_empty());
    assert_eq!(w.list("", 0).unwrap()[0].updated_at, updated);
    let snapshot = w.load(&id).unwrap().unwrap();
    assert_eq!(snapshot.document, vec![3, 4]);
    assert_eq!(snapshot.collection, vec![1, 2]);
    assert_eq!(w.get_blob("asset").unwrap(), b"retained");
    let organized = w.membership(&id).unwrap();
    assert!(organized.collections.contains(&folder));
    assert!(organized.collections.contains(&tag));
}

#[test]
fn trash_paginates_stably() {
    let tmp = tempfile::tempdir().unwrap();
    let w = Workspace::open(tmp.path().join("workspace")).unwrap();
    for _ in 0..105 {
        let id = w.create("whiteboard").unwrap();
        w.delete(&id).unwrap();
    }
    w.db.execute("UPDATE objects SET deleted_at=1", []).unwrap();
    let first = w.trash("", 0).unwrap();
    let second = w.trash("", 100).unwrap();
    assert_eq!(first.len(), 100);
    assert_eq!(second.len(), 5);
    assert!(first.last().unwrap().object.id < second[0].object.id);
}

#[test]
fn managed_workspace_switch_and_failure_preservation() {
    use super::workspaces;
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    let original = workspaces::startup(base).unwrap();
    let id = original.create("note").unwrap();
    let archive = base.join("copy.knot");
    backup::export(&original, &archive).unwrap();
    let restored_root = backup::restore(&archive, base).unwrap();
    let restored_id = restored_root.file_name().unwrap().to_str().unwrap();
    let mut current = Ok(original);
    assert_eq!(
        workspaces::catalog(base, &current).unwrap().entries.len(),
        2
    );
    workspaces::switch(base, &mut current, "Workspace").unwrap();
    let held = Workspace::open(restored_root.clone()).unwrap();
    assert!(workspaces::switch(base, &mut current, restored_id).is_err());
    assert_eq!(current.as_ref().unwrap().root, base.join("Workspace"));
    drop(held);
    // A failed selection-file replacement must retain the old workspace/lock.
    std::fs::create_dir(base.join("active-workspace.txt")).unwrap();
    assert!(workspaces::switch(base, &mut current, restored_id).is_err());
    assert!(Workspace::open(base.join("Workspace")).is_err());
    assert!(Workspace::open(restored_root.clone()).is_ok());
    std::fs::remove_dir(base.join("active-workspace.txt")).unwrap();
    workspaces::switch(base, &mut current, restored_id).unwrap();
    assert_eq!(current.as_ref().unwrap().list("", 0).unwrap()[0].id, id);
    assert!(Workspace::open(base.join("Workspace")).is_ok());
    assert!(workspaces::switch(base, &mut current, "../Workspace").is_err());
    assert!(workspaces::switch(base, &mut current, "missing").is_err());
    assert!(!base.join("missing").exists());
    drop(current);
    let reopened = workspaces::startup(base).unwrap();
    assert_eq!(reopened.root, restored_root);
    let mut current = Ok(reopened);
    workspaces::switch(base, &mut current, "Workspace").unwrap();
    assert_eq!(
        std::fs::read_to_string(base.join("active-workspace.txt")).unwrap(),
        "Workspace"
    );
}

#[test]
fn missing_selected_workspace_is_not_recreated_and_picker_recovers() {
    use super::workspaces;
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    drop(workspaces::startup(base).unwrap());
    std::fs::write(base.join("active-workspace.txt"), "missing").unwrap();
    assert!(workspaces::startup(base).is_err());
    assert!(!base.join("missing").exists());
    let mut current = Err("Unavailable workspace".to_string());
    let catalog = workspaces::catalog(base, &current).unwrap();
    assert!(catalog.active.is_none());
    assert_eq!(catalog.entries.len(), 1);
    workspaces::switch(base, &mut current, "Workspace").unwrap();
    assert!(current.is_ok());
    drop(current);
    std::fs::write(base.join("Workspace/workspace.json"), "broken").unwrap();
    assert!(workspaces::startup(base).is_err());
    assert_eq!(
        std::fs::read_to_string(base.join("Workspace/workspace.json")).unwrap(),
        "broken"
    );
}

#[test]
fn managed_backup_lifecycle_and_failures() {
    use super::{managed_backups as managed, workspaces};
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    let mut current = Ok(workspaces::startup(base).unwrap());
    let original_id = current.as_ref().unwrap().create("note").unwrap();
    let first = managed::create(base, current.as_ref().unwrap()).unwrap();
    let second = managed::create(base, current.as_ref().unwrap()).unwrap();
    assert_ne!(first, second);
    assert_eq!(managed::list(base).unwrap().len(), 2);
    managed::validate(base, &first).unwrap();
    assert_eq!(
        workspaces::catalog(base, &current).unwrap().entries.len(),
        1
    );
    assert_eq!(std::fs::read_dir(base.join("Backups")).unwrap().count(), 2);
    for bad in ["../Workspace/knot.db", "../test.knot", "missing.knot"] {
        assert!(managed::delete(base, bad).is_err());
        assert!(managed::validate(base, bad).is_err());
        assert!(managed::restore(base, &mut current, bad).is_err());
    }
    std::fs::write(base.join("Backups/broken.knot"), b"broken").unwrap();
    assert!(managed::validate(base, "broken.knot").is_err());
    assert!(managed::restore(base, &mut current, "broken.knot").is_err());
    assert_eq!(current.as_ref().unwrap().root, base.join("Workspace"));
    assert_eq!(
        workspaces::catalog(base, &current).unwrap().entries.len(),
        1
    );
    std::fs::create_dir(base.join("active-workspace.txt")).unwrap();
    assert!(managed::restore(base, &mut current, &first).is_err());
    assert_eq!(current.as_ref().unwrap().root, base.join("Workspace"));
    assert!(Workspace::open(base.join("Workspace")).is_err());
    std::fs::remove_dir(base.join("active-workspace.txt")).unwrap();
    let restored = managed::restore(base, &mut current, &first).unwrap();
    assert_eq!(
        current.as_ref().unwrap().list("", 0).unwrap()[0].id,
        original_id
    );
    drop(current);
    assert_eq!(
        workspaces::startup(base)
            .unwrap()
            .root
            .display()
            .to_string(),
        restored
    );
    managed::delete(base, &first).unwrap();
    assert!(managed::resolve(base, &first).is_err());
    assert!(base.join("Workspace/knot.db").is_file());
    assert!(managed::resolve(base, &second).is_ok());
}

#[test]
fn failed_managed_backup_leaves_no_archive() {
    use super::{managed_backups as managed, workspaces};
    let tmp = tempfile::tempdir().unwrap();
    let mut w = workspaces::startup(tmp.path()).unwrap();
    let id = w.create("note").unwrap();
    w.put_blob(&id, "asset", b"content", "file", "text/plain")
        .unwrap();
    let hash: String =
        w.db.query_row("SELECT sha256 FROM attachments LIMIT 1", [], |r| r.get(0))
            .unwrap();
    std::fs::write(w.asset_path(&hash).unwrap(), b"corrupt").unwrap();
    assert!(managed::create(tmp.path(), &w).is_err());
    assert!(managed::list(tmp.path()).unwrap().is_empty());
    assert_eq!(
        std::fs::read_dir(tmp.path().join("Backups"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn external_workspace_selection_persists_and_preserves_failures() {
    use super::{managed_backups, workspaces};
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("managed");
    std::fs::create_dir(&base).unwrap();
    let root = tmp.path().join("External notes with spaces");
    let mut external = Workspace::open(root.clone()).unwrap();
    let id = external.create("note").unwrap();
    external
        .save(
            &id,
            &Snapshot {
                title: Some("External".into()),
                collection: vec![1],
                document: vec![2],
            },
        )
        .unwrap();
    let mut current = Ok(workspaces::startup(&base).unwrap());
    assert!(workspaces::open_external(&base, &mut current, &root).is_err());
    assert_eq!(current.as_ref().unwrap().root, base.join("Workspace"));
    drop(external);
    let empty = tmp.path().join("empty");
    std::fs::create_dir(&empty).unwrap();
    assert!(workspaces::open_external(&base, &mut current, &empty).is_err());
    assert!(!empty.join("workspace.json").exists());
    std::fs::create_dir(base.join("external-workspaces.json")).unwrap();
    assert!(workspaces::open_external(&base, &mut current, &root).is_err());
    assert!(Workspace::open(base.join("Workspace")).is_err());
    assert!(Workspace::open(root.clone()).is_ok());
    std::fs::remove_dir(base.join("external-workspaces.json")).unwrap();
    std::fs::create_dir(base.join("active-workspace.txt")).unwrap();
    assert!(workspaces::open_external(&base, &mut current, &root).is_err());
    assert_eq!(current.as_ref().unwrap().root, base.join("Workspace"));
    std::fs::remove_dir(base.join("active-workspace.txt")).unwrap();
    workspaces::open_external(&base, &mut current, &root).unwrap();
    let catalog = workspaces::catalog(&base, &current).unwrap();
    let external_id = catalog.active.unwrap();
    assert!(external_id.starts_with("external-"));
    assert_eq!(catalog.entries.len(), 2);
    // Canonical aliases must not attempt to reacquire the current lock or duplicate entries.
    workspaces::open_external(&base, &mut current, &root.join(".")).unwrap();
    assert_eq!(
        workspaces::catalog(&base, &current).unwrap().entries.len(),
        2
    );
    let archive = managed_backups::create(&base, current.as_ref().unwrap()).unwrap();
    managed_backups::validate(&base, &archive).unwrap();
    assert_eq!(managed_backups::list(&base).unwrap().len(), 1);
    drop(current);
    let mut current = Ok(workspaces::startup(&base).unwrap());
    assert_eq!(
        current
            .as_ref()
            .unwrap()
            .load(&id)
            .unwrap()
            .unwrap()
            .document,
        vec![2]
    );
    workspaces::switch(&base, &mut current, "Workspace").unwrap();
    workspaces::switch(&base, &mut current, &external_id).unwrap();
    drop(current);
    let offline = tmp.path().join("offline");
    std::fs::rename(&root, &offline).unwrap();
    assert!(workspaces::startup(&base).is_err());
    assert!(!root.exists());
    let mut current = Err("Offline".into());
    assert_eq!(
        workspaces::catalog(&base, &current).unwrap().entries.len(),
        2
    );
    workspaces::switch(&base, &mut current, "Workspace").unwrap();
    assert!(workspaces::switch(&base, &mut current, &external_id).is_err());
    assert!(current.is_ok());
    std::fs::rename(&offline, &root).unwrap();
    workspaces::switch(&base, &mut current, &external_id).unwrap();
    assert_eq!(
        current
            .as_ref()
            .unwrap()
            .load(&id)
            .unwrap()
            .unwrap()
            .document,
        vec![2]
    );
}

#[test]
fn relocation_preserves_identity_trash_assets_and_source() {
    use super::workspaces;
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("managed");
    std::fs::create_dir(&base).unwrap();
    let mut original = workspaces::startup(&base).unwrap();
    let id = original.create("note").unwrap();
    original
        .save(
            &id,
            &Snapshot {
                title: Some("Retained".into()),
                collection: vec![1, 2],
                document: vec![3, 4],
            },
        )
        .unwrap();
    original
        .put_blob(&id, "asset", b"attachment", "file", "text/plain")
        .unwrap();
    let tag = original.create_collection("Tag", None).unwrap();
    original
        .set_membership(
            &id,
            &super::collections::Membership {
                collections: vec![tag.clone()],
            },
        )
        .unwrap();
    original.delete(&id).unwrap();
    let source_manifest = std::fs::read(original.root.join("workspace.json")).unwrap();
    let parent = tmp.path().join("Destination");
    std::fs::create_dir(&parent).unwrap();
    std::fs::write(parent.join("unrelated.txt"), "keep").unwrap();
    let mut current = Ok(original);
    assert!(workspaces::relocate(&base, &mut current, &base.join("Workspace/assets")).is_err());
    let target = workspaces::relocate(&base, &mut current, &parent).unwrap();
    assert_eq!(
        target.parent(),
        Some(parent.canonicalize().unwrap().as_path())
    );
    let next = current.as_ref().unwrap();
    assert_eq!(
        std::fs::read(next.root.join("workspace.json")).unwrap(),
        source_manifest
    );
    assert_eq!(next.trash("", 0).unwrap()[0].object.id, id);
    next.restore_object(&id).unwrap();
    assert_eq!(next.load(&id).unwrap().unwrap().document, vec![3, 4]);
    assert_eq!(next.membership(&id).unwrap().collections, vec![tag]);
    assert_eq!(next.get_blob("asset").unwrap(), b"attachment");
    next.rename(&id, "New location").unwrap();
    let old = Workspace::open(base.join("Workspace")).unwrap();
    assert_eq!(old.trash("", 0).unwrap()[0].object.title, "Retained");
    assert_eq!(old.get_blob("asset").unwrap(), b"attachment");
    assert_eq!(
        std::fs::read_to_string(parent.join("unrelated.txt")).unwrap(),
        "keep"
    );
    assert_eq!(std::fs::read_dir(&parent).unwrap().count(), 2);
    drop(current);
    assert_eq!(workspaces::startup(&base).unwrap().root, target);
}

#[test]
fn relocation_and_registry_failures_are_recoverable() {
    use super::workspaces;
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().join("managed");
    std::fs::create_dir(&base).unwrap();
    let mut current = Ok(workspaces::startup(&base).unwrap());
    let parent = tmp.path().join("Destination");
    std::fs::create_dir(&parent).unwrap();
    std::fs::create_dir(base.join("active-workspace.txt")).unwrap();
    assert!(workspaces::relocate(&base, &mut current, &parent).is_err());
    assert_eq!(current.as_ref().unwrap().root, base.join("Workspace"));
    assert!(Workspace::open(base.join("Workspace")).is_err());
    assert_eq!(std::fs::read_dir(&parent).unwrap().count(), 1);
    let target_id = workspaces::catalog(&base, &current)
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.id.starts_with("external-"))
        .unwrap()
        .id;
    std::fs::remove_dir(base.join("active-workspace.txt")).unwrap();
    workspaces::switch(&base, &mut current, &target_id).unwrap();
    std::fs::write(base.join("external-workspaces.json"), "broken").unwrap();
    let catalog = workspaces::catalog(&base, &current).unwrap();
    assert!(catalog.warning.is_some());
    workspaces::switch(&base, &mut current, "Workspace").unwrap();
    drop(current);
    assert!(workspaces::startup(&base).is_ok());
    assert_eq!(
        std::fs::read_to_string(base.join("external-workspaces.json")).unwrap(),
        "broken"
    );
}

#[test]
fn document_exports_validate_and_publish_without_overwriting() {
    use super::exports::{self, ExportFile};
    use std::io::Read;
    let tmp = tempfile::tempdir().unwrap();
    let markdown = vec![ExportFile {
        name: "index.md".into(),
        bytes: b"# Title\n\n**Bold**".to_vec(),
    }];
    let path = tmp.path().join("note.md");
    exports::write(&path, "markdown", &markdown).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), markdown[0].bytes);
    assert!(exports::write(&path, "markdown", &markdown).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), markdown[0].bytes);
    let zip = tmp.path().join("note.zip");
    let export_files = vec![
        ExportFile {
            name: "index.md".into(),
            bytes: b"![image](assets/image.png)".to_vec(),
        },
        ExportFile {
            name: "assets/image.png".into(),
            bytes: vec![1, 2, 3],
        },
    ];
    exports::write(&zip, "markdown", &export_files).unwrap();
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip).unwrap()).unwrap();
    let mut bytes = Vec::new();
    archive
        .by_name("assets/image.png")
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap();
    assert_eq!(bytes, vec![1, 2, 3]);
    for bad in [
        "../outside",
        "assets/../outside",
        "assets/a/b",
        "assets/C:bad",
    ] {
        let files = vec![ExportFile {
            name: bad.into(),
            bytes: vec![1],
        }];
        assert!(exports::write(&tmp.path().join("bad.zip"), "markdown", &files).is_err());
    }
    for format in ["png", "pdf", "unknown"] {
        assert!(exports::validate(format, &markdown).is_err());
    }
    for (format, signature) in [
        ("png", b"\x89PNG\r\n\x1a\n".as_slice()),
        ("pdf", b"%PDF-1.7".as_slice()),
    ] {
        let files = vec![ExportFile {
            name: format!("document.{format}"),
            bytes: signature.to_vec(),
        }];
        exports::write(&tmp.path().join(format!("out.{format}")), format, &files).unwrap();
    }
    assert!(exports::write(&tmp.path().join("absent/note.md"), "markdown", &markdown).is_err());
    assert!(!tmp.path().join("bad.zip").exists());
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 4);
    assert_eq!(exports::filename("CON", "md"), "Knot-CON.md");
    assert_eq!(exports::filename("a/b: title", "md"), "Knot-a-b- title.md");
}

#[test]
fn integrity_reports_shared_and_trashed_associations_without_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("audit")).unwrap();
    let a = w.create("note").unwrap();
    let b = w.create("whiteboard").unwrap();
    w.save(
        &a,
        &Snapshot {
            collection: vec![1],
            document: vec![2],
            title: None,
        },
    )
    .unwrap();
    w.put_blob(&a, "shared", b"original", "photo.png", "image/png")
        .unwrap();
    w.put_blob(&b, "shared", b"original", "photo.png", "image/png")
        .unwrap();
    w.delete(&b).unwrap();
    let hash: String =
        w.db.query_row("SELECT sha256 FROM attachments", [], |r| r.get(0))
            .unwrap();
    let wrong = w.root.join("assets/wrong");
    std::fs::create_dir_all(&wrong).unwrap();
    std::fs::write(wrong.join(&hash), b"original").unwrap();
    std::fs::write(w.root.join("assets/interrupted.tmp"), b"retained").unwrap();
    std::fs::write(w.asset_path(&hash).unwrap(), b"modified").unwrap();
    w.db.execute_batch("PRAGMA foreign_keys=OFF; INSERT INTO object_attachments VALUES ('absent','shared'); PRAGMA query_only=ON;").unwrap();
    let report = w.integrity().unwrap();
    assert_eq!(report.database_issues.len(), 1);
    assert_eq!(report.document_snapshots.len(), 2);
    let live = report
        .document_snapshots
        .iter()
        .find(|d| d.id == a)
        .unwrap();
    assert!(!live.deleted);
    assert_eq!(live.snapshot.as_ref().unwrap().document, vec![2]);
    let trash = report
        .document_snapshots
        .iter()
        .find(|d| d.id == b)
        .unwrap();
    assert!(trash.deleted);
    assert!(trash.snapshot.is_none());
    assert_eq!(report.corrupt, vec![hash.clone()]);
    assert_eq!(
        report.orphan_files,
        vec!["interrupted.tmp".to_string(), format!("wrong/{hash}")]
    );
    assert_eq!(report.affected_attachments.len(), 1);
    let asset = &report.affected_attachments[0];
    assert_eq!(asset.name, "photo.png");
    assert_eq!(asset.documents.len(), 2);
    assert!(asset.documents.iter().any(|d| d.id == a && !d.deleted));
    assert!(asset.documents.iter().any(|d| d.id == b && d.deleted));
    assert_eq!(w.load(&a).unwrap().unwrap().document, vec![2]);
    assert_eq!(std::fs::read(wrong.join(hash)).unwrap(), b"original");
    assert_eq!(w.trash("", 0).unwrap().len(), 1);
}

#[test]
fn purge_trash_is_atomic_and_preserves_live_documents_and_shared_assets() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let live = w.create("note").unwrap();
    let deleted = w.create("note").unwrap();
    w.save(
        &deleted,
        &Snapshot {
            title: None,
            collection: vec![1],
            document: vec![2],
        },
    )
    .unwrap();
    w.put_blob(&deleted, "shared", b"shared", "file", "text/plain")
        .unwrap();
    w.put_blob(&live, "shared", b"shared", "file", "text/plain")
        .unwrap();
    w.put_blob(&deleted, "private", b"private", "file", "text/plain")
        .unwrap();
    w.delete(&deleted).unwrap();
    assert!(w.purge_trash(&[deleted.clone(), live.clone()]).is_err());
    assert!(w.load(&deleted).unwrap().is_some());
    w.db.execute_batch("CREATE TRIGGER reject_purge BEFORE DELETE ON objects BEGIN SELECT RAISE(FAIL,'failure'); END;").unwrap();
    assert!(w.purge_trash(std::slice::from_ref(&deleted)).is_err());
    assert!(w.load(&deleted).unwrap().is_some());
    assert_eq!(w.blobs(&deleted).unwrap().len(), 2);
    w.db.execute_batch("DROP TRIGGER reject_purge;").unwrap();
    assert_eq!(w.purge_trash(std::slice::from_ref(&deleted)).unwrap(), 1);
    assert!(w.load(&deleted).unwrap().is_none());
    assert!(w.restore_object(&deleted).is_err());
    assert_eq!(w.get_blob("shared").unwrap(), b"shared");
    assert!(w.get_blob("private").is_err());
    assert_eq!(w.list("", 0).unwrap()[0].id, live);
    assert!(w.trash("", 0).unwrap().is_empty());
    for _ in 0..105 {
        let id = w.create("note").unwrap();
        w.delete(&id).unwrap();
    }
    let mut ids: Vec<String> = w
        .trash("", 0)
        .unwrap()
        .into_iter()
        .map(|r| r.object.id)
        .collect();
    ids.extend(w.trash("", 100).unwrap().into_iter().map(|r| r.object.id));
    assert_eq!(w.purge_trash(&ids).unwrap(), 105);
    assert!(w.trash("", 0).unwrap().is_empty());
}

#[test]
fn automatic_trash_retention_boundary_and_rollback() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let timestamp = 2_000_000_000_000_i64;
    let cutoff = timestamp - 30 * 24 * 60 * 60 * 1000;
    let live = w.create("note").unwrap();
    let recent = w.create("note").unwrap();
    let restored = w.create("note").unwrap();
    let expired = w.create("note").unwrap();
    w.save(
        &expired,
        &Snapshot {
            title: None,
            collection: vec![1],
            document: vec![2],
        },
    )
    .unwrap();
    w.put_blob(&expired, "shared", b"shared", "file", "text/plain")
        .unwrap();
    w.put_blob(&live, "shared", b"shared", "file", "text/plain")
        .unwrap();
    for id in [&recent, &restored, &expired] {
        w.delete(id).unwrap();
    }
    w.db.execute(
        "UPDATE objects SET deleted_at=?1 WHERE id=?2",
        rusqlite::params![cutoff + 1, recent],
    )
    .unwrap();
    for id in [&restored, &expired] {
        w.db.execute(
            "UPDATE objects SET deleted_at=?1 WHERE id=?2",
            rusqlite::params![cutoff, id],
        )
        .unwrap();
    }
    w.restore_object(&restored).unwrap();
    // More than one UI page must be removed, including the exact boundary.
    for _ in 0..105 {
        let id = w.create("note").unwrap();
        w.db.execute(
            "UPDATE objects SET deleted_at=?1 WHERE id=?2",
            rusqlite::params![cutoff - 1, id],
        )
        .unwrap();
    }
    w.db.execute_batch("CREATE TRIGGER reject_expiry BEFORE DELETE ON objects BEGIN SELECT RAISE(FAIL,'failure'); END;").unwrap();
    assert!(w.clear_expired_trash(timestamp).is_err());
    assert!(w.load(&expired).unwrap().is_some());
    assert_eq!(w.blobs(&expired).unwrap().len(), 1);
    w.db.execute_batch("DROP TRIGGER reject_expiry;").unwrap();
    assert_eq!(w.clear_expired_trash(timestamp).unwrap(), 106);
    assert!(w.load(&expired).unwrap().is_none());
    assert_eq!(w.get_blob("shared").unwrap(), b"shared");
    assert_eq!(w.trash("", 0).unwrap()[0].object.id, recent);
    let live_ids: Vec<_> = w
        .list("", 0)
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect();
    assert!(live_ids.contains(&live));
    assert!(live_ids.contains(&restored));
    assert_eq!(w.clear_expired_trash(timestamp).unwrap(), 0);
    assert_eq!(w.clear_expired_trash(timestamp + 1).unwrap(), 1);
}

#[test]
fn favorites_persist_and_follow_notebook_lifecycle() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("workspace");
    let mut w = Workspace::open(path.clone()).unwrap();
    let id = w.create("note").unwrap();
    w.set_favorite(&id, true).unwrap();
    w.set_favorite(&id, true).unwrap();
    assert_eq!(w.catalog().unwrap().favorites, vec![id.clone()]);
    assert!(w.set_favorite("missing", true).is_err());
    drop(w);
    w = Workspace::open(path).unwrap();
    assert_eq!(w.catalog().unwrap().favorites, vec![id.clone()]);
    assert!(Workspace::open(tmp.path().join("other"))
        .unwrap()
        .catalog()
        .unwrap()
        .favorites
        .is_empty());
    w.delete(&id).unwrap();
    assert!(w.catalog().unwrap().favorites.is_empty());
    assert!(w.set_favorite(&id, true).is_err());
    w.restore_object(&id).unwrap();
    assert_eq!(w.catalog().unwrap().favorites, vec![id.clone()]);
    w.set_favorite(&id, false).unwrap();
    assert!(w.catalog().unwrap().favorites.is_empty());
    w.set_favorite(&id, true).unwrap();
    w.delete(&id).unwrap();
    w.purge_trash(&[id]).unwrap();
    let count: i64 =
        w.db.query_row("SELECT count(*) FROM favorites", [], |r| r.get(0))
            .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn collection_order_survives_restart_and_rejects_stale_lists() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("workspace");
    let mut w = Workspace::open(path.clone()).unwrap();
    let a = w.create_collection("A", None).unwrap();
    let b = w.create_collection("B", None).unwrap();
    w.reorder_collections(vec![b.clone(), a.clone()]).unwrap();
    assert!(w.reorder_collections(vec![a.clone(), a.clone()]).is_err());
    assert!(w
        .reorder_collections(vec![a.clone(), "missing".into()])
        .is_err());
    drop(w);
    let mut w = Workspace::open(path).unwrap();
    assert_eq!(
        w.catalog()
            .unwrap()
            .collections
            .iter()
            .map(|c| c.id.clone())
            .collect::<Vec<_>>(),
        vec![b.clone(), a.clone()]
    );
    w.rename_collection(&b, "Z").unwrap();
    let c = w.create_collection("C", None).unwrap();
    assert_eq!(
        w.catalog()
            .unwrap()
            .collections
            .iter()
            .map(|c| c.id.clone())
            .collect::<Vec<_>>(),
        vec![b, a, c]
    );
}
#[test]
fn library_pagination_dates_and_filters() {
    let tmp = tempfile::tempdir().unwrap();
    let w = Workspace::open(tmp.path().join("workspace")).unwrap();
    for i in 0..205 {
        w.db.execute(
            "INSERT INTO objects(id,title,kind,updated_at) VALUES(?1,?2,'note',?3)",
            rusqlite::params![format!("row-{i:03}"), format!("Notebook {i:03}"), i],
        )
        .unwrap();
    }
    let first = w.library_page("", None, false, 0).unwrap();
    let second = w.library_page("", None, false, 100).unwrap();
    assert_eq!(first.total, 205);
    assert_eq!(first.rows.len(), 100);
    assert_eq!(second.rows.len(), 100);
    assert_eq!(first.rows[0].object.id, "row-204");
    assert_eq!(second.rows[0].object.id, "row-104");
    assert_eq!(w.library_page("", None, false, 200).unwrap().rows.len(), 5);
    w.db.execute("UPDATE objects SET updated_at=1000 WHERE id='row-000'", [])
        .unwrap();
    assert_eq!(
        w.library_page("", None, false, 0).unwrap().rows[0]
            .object
            .id,
        "row-000"
    );
    assert_eq!(
        w.library_page("", None, true, 0).unwrap().rows[0].object.id,
        "row-204"
    );
    w.db.execute(
        "INSERT INTO collections(id,name) VALUES('c','Research')",
        [],
    )
    .unwrap();
    w.db.execute(
        "INSERT INTO collection_objects(collection_id,object_id) VALUES('c','row-204')",
        [],
    )
    .unwrap();
    assert_eq!(w.library_page("", Some("c"), false, 0).unwrap().total, 1);
    assert_eq!(w.library_page("", Some(""), false, 0).unwrap().total, 204);
    assert_eq!(
        w.library_page("NOTEBOOK 204", None, false, 0)
            .unwrap()
            .total,
        1
    );
    w.db.execute("UPDATE objects SET deleted_at=1 WHERE id='row-204'", [])
        .unwrap();
    assert_eq!(w.library_page("", Some("c"), false, 0).unwrap().total, 0);
    w.db.execute("UPDATE objects SET created_at=NULL WHERE id='row-000'", [])
        .unwrap();
    assert!(
        w.library_page("Notebook 000", None, true, 0).unwrap().rows[0]
            .created_at
            .is_none()
    );
}

#[test]
fn collection_trash_keeps_notebooks_and_restores_memberships() {
    use crate::collections::Membership;
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let notebook = w.create("note").unwrap();
    let folder = w.create_collection("Recover me", Some(&notebook)).unwrap();
    w.delete_collection(&folder).unwrap();
    assert!(w.catalog().unwrap().collections.is_empty());
    assert_eq!(w.list("", 0).unwrap().len(), 1);
    assert_eq!(w.library_page("", Some(""), false, 0).unwrap().total, 1);
    assert!(w.membership(&notebook).unwrap().collections.is_empty());
    let trash = w.trash("recover", 0).unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].object.kind, "collection");
    // Editing visible memberships must not destroy the recoverable association.
    w.set_membership(
        &notebook,
        &Membership {
            collections: vec![],
        },
    )
    .unwrap();
    w.restore_object(&folder).unwrap();
    assert_eq!(
        w.membership(&notebook).unwrap().collections,
        vec![folder.clone()]
    );
    assert!(w.purge_trash(&[folder.clone()]).is_err());
    w.delete_collection(&folder).unwrap();
    assert_eq!(w.purge_trash(&[folder]).unwrap(), 1);
    assert_eq!(w.list("", 0).unwrap().len(), 1);
    assert!(w.membership(&notebook).unwrap().collections.is_empty());
    let expired = w.create_collection("Expired", Some(&notebook)).unwrap();
    w.delete_collection(&expired).unwrap();
    assert_eq!(
        w.clear_expired_trash(crate::storage::now() + 31 * 86400000)
            .unwrap(),
        1
    );
    assert_eq!(w.list("", 0).unwrap().len(), 1);
}

#[test]
fn collection_trash_migrates_version_seven_with_recovery_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("workspace");
    let mut w = Workspace::open(root.clone()).unwrap();
    let notebook = w.create("note").unwrap();
    let folder = w.create_collection("Keep", Some(&notebook)).unwrap();
    w.db.execute_batch("ALTER TABLE collections DROP COLUMN deleted_at; DROP TABLE mcq_progress; DROP TABLE mcq_attempts; DROP TABLE mcq_drafts; DROP TABLE card_deck; DROP TABLE notebook_origins; DROP TABLE unshared_references; DROP TABLE ai_chats; DELETE FROM schema_migrations WHERE version>=8; PRAGMA user_version=7;").unwrap();
    drop(w);
    let w = Workspace::open(root).unwrap();
    assert_eq!(
        w.membership(&notebook).unwrap().collections,
        vec![folder.clone()]
    );
    assert!(!crate::migrations::recovery_archives(&w.root)
        .unwrap()
        .is_empty());
    w.delete_collection(&folder).unwrap();
    assert_eq!(w.trash("", 0).unwrap().len(), 1);
    assert_eq!(w.list("", 0).unwrap().len(), 1);
}

#[test]
fn card_deck_persists_and_rolls_back_with_failed_document_save() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("deck");
    let mut w = Workspace::open(root.clone()).unwrap();
    w.save_documents_with_deck(&[], Some(r#"{"card":{"text":"Keep"}}"#))
        .unwrap();
    let bad = crate::storage::DocumentWrite {
        id: "missing".into(),
        create: false,
        snapshot: crate::storage::Snapshot {
            collection: vec![],
            document: vec![],
            title: None,
        },
    };
    assert!(w.save_documents_with_deck(&[bad], Some("{}")).is_err());
    drop(w);
    let w = Workspace::open(root).unwrap();
    let content: String =
        w.db.query_row("SELECT content FROM card_deck WHERE id=1", [], |r| r.get(0))
            .unwrap();
    assert!(content.contains("Keep"));
}
#[test]
fn card_deck_retains_assets_after_last_notebook_is_purged() {
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("deck-assets")).unwrap();
    let id = w.create("whiteboard").unwrap();
    w.put_blob(&id, "deck-image", b"image", "image.png", "image/png")
        .unwrap();
    w.save_documents_with_deck(&[], Some(r#"{"card":{"sourceId":"deck-image"}}"#))
        .unwrap();
    w.delete(&id).unwrap();
    w.purge_trash(&[id]).unwrap();
    assert_eq!(w.get_blob("deck-image").unwrap(), b"image");
    let archive = tmp.path().join("deck.knot");
    crate::backup::export(&w, &archive).unwrap();
    let restored = crate::backup::restore(&archive, tmp.path()).unwrap();
    let restored = Workspace::open(restored).unwrap();
    assert_eq!(restored.get_blob("deck-image").unwrap(), b"image");
}

#[test]
fn card_editor_assets_do_not_require_a_notebook() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("workspace");
    let mut w = Workspace::open(root.clone()).unwrap();
    w.save_documents_with_deck(&[], Some(r#"{"standalone":{"id":"standalone","nodes":[]}}"#)).unwrap();
    w.put_blob("knot:card:standalone", "card-asset", b"image", "image.png", "image/png").unwrap();
    assert!(w.list("", 0).unwrap().is_empty());
    assert!(w.put_blob("knot:card:missing", "missing-asset", b"bad", "bad.png", "image/png").is_err());
    assert!(w.get_blob("missing-asset").is_err());
    w.save_documents_with_deck(&[], Some(r#"{"standalone":{"id":"standalone","deleted":true,"nodes":[]}}"#)).unwrap();
    assert!(w.put_blob("knot:card:standalone", "deleted-asset", b"bad", "bad.png", "image/png").is_err());
    drop(w);
    let reopened = Workspace::open(root).unwrap();
    assert_eq!(reopened.get_blob("card-asset").unwrap(), b"image");
}
