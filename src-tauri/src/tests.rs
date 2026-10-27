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
    assert_eq!(v, 1);
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
