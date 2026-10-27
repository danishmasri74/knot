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
    assert_eq!(v, 2);
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
fn organization_survives_reopen_and_backup() {
    use crate::organization::Organization;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("workspace");
    let mut w = Workspace::open(path.clone()).unwrap();
    let id = w.create("note").unwrap();
    let folder = w.create_label("folder", " Research ").unwrap();
    let tag = w.create_label("tag", "Important").unwrap();
    w.organize(
        &id,
        &Organization {
            folder: Some(folder.clone()),
            tags: vec![tag.clone()],
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
    assert_eq!(
        w.organization(&id).unwrap().folder.as_deref(),
        Some(folder.as_str())
    );
    assert_eq!(w.organization(&id).unwrap().tags, vec![tag.clone()]);
    assert_eq!(
        w.filtered_list("research", 0, Some(&folder), Some(&tag))
            .unwrap()
            .len(),
        1
    );
    assert!(w.filtered_list("", 0, Some(""), None).unwrap().is_empty());
    let archive = tmp.path().join("organized.knot");
    backup::export(&w, &archive).unwrap();
    let restored = Workspace::open(backup::restore(&archive, tmp.path()).unwrap()).unwrap();
    assert_eq!(restored.catalog().unwrap().folders[0].name, "Research");
    assert_eq!(restored.organization(&id).unwrap().tags, vec![tag]);
    assert_eq!(restored.load(&id).unwrap().unwrap().document, vec![2]);
    restored
        .rename_label("folder", &folder, "Projects")
        .unwrap();
    restored.delete_label("folder", &folder).unwrap();
    let tag = &restored.catalog().unwrap().tags[0].id;
    restored.delete_label("tag", tag).unwrap();
    assert!(restored.organization(&id).unwrap().folder.is_none());
    assert!(restored.organization(&id).unwrap().tags.is_empty());
    assert_eq!(restored.list("", 0).unwrap().len(), 1);
    assert_eq!(restored.load(&id).unwrap().unwrap().document, vec![2]);
}

#[test]
fn invalid_organization_changes_roll_back() {
    use crate::organization::Organization;
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let id = w.create("note").unwrap();
    let folder = w.create_label("folder", "Work").unwrap();
    let tag = w.create_label("tag", "Priority").unwrap();
    assert!(w.create_label("folder", "work").is_err());
    assert!(w.create_label("tag", "  ").is_err());
    assert!(w.create_label("invalid", "Name").is_err());
    assert!(w.create_label("folder", &"x".repeat(101)).is_err());
    w.organize(
        &id,
        &Organization {
            folder: Some(folder.clone()),
            tags: vec![tag.clone(), tag.clone()],
        },
    )
    .unwrap();
    assert!(w
        .organize(
            &id,
            &Organization {
                folder: None,
                tags: vec!["missing".into()]
            }
        )
        .is_err());
    assert_eq!(w.organization(&id).unwrap().folder, Some(folder));
    assert_eq!(w.organization(&id).unwrap().tags, vec![tag]);
    assert!(w
        .organize(
            &id,
            &Organization {
                folder: Some("missing".into()),
                tags: vec![]
            }
        )
        .is_err());
    w.delete(&id).unwrap();
    assert!(w
        .organize(
            &id,
            &Organization {
                folder: None,
                tags: vec![]
            }
        )
        .is_err());
    assert!(w.filtered_list("", 0, None, None).unwrap().is_empty());
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
    assert!(w.organization("legacy").unwrap().folder.is_none());
    assert!(w.catalog().unwrap().folders.is_empty());
}

#[test]
fn organization_filters_paginate_and_combine_with_search() {
    use crate::organization::Organization;
    let tmp = tempfile::tempdir().unwrap();
    let mut w = Workspace::open(tmp.path().join("workspace")).unwrap();
    let folder = w.create_label("folder", "Work").unwrap();
    let tag = w.create_label("tag", "Read").unwrap();
    for n in 0..105 {
        let id = w.create("note").unwrap();
        w.rename(&id, &format!("Match {n}")).unwrap();
        w.organize(
            &id,
            &Organization {
                folder: Some(folder.clone()),
                tags: vec![tag.clone()],
            },
        )
        .unwrap();
    }
    w.create("note").unwrap();
    let a = w
        .filtered_list("Match", 0, Some(&folder), Some(&tag))
        .unwrap();
    let b = w
        .filtered_list("Match", 100, Some(&folder), Some(&tag))
        .unwrap();
    assert_eq!(a.len(), 100);
    assert_eq!(b.len(), 5);
    assert!(a.iter().all(|x| b.iter().all(|y| x.id != y.id)));
    assert_eq!(w.filtered_list("", 0, Some(""), None).unwrap().len(), 1);
    assert!(w
        .filtered_list("absent", 0, Some(&folder), Some(&tag))
        .unwrap()
        .is_empty());
}
