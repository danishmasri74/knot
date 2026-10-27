use crate::storage::{hash_file, Manifest, Result, Workspace};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub fn export(ws: &Workspace, dest: &Path) -> Result<()> {
    if dest.exists() {
        return Err("Choose a new filename; existing backups are never overwritten".into());
    }
    let staging = ws
        .root
        .join("backups")
        .join(format!("{}.db", uuid::Uuid::new_v4()));
    ws.db.backup(rusqlite::DatabaseName::Main, &staging, None)?;
    let tmp = dest.with_extension(format!("{}.partial", uuid::Uuid::new_v4()));
    let outcome = (|| -> Result<()> {
        let mut zip = ZipWriter::new(File::create(&tmp)?);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, path) in [
            ("workspace.json", ws.root.join("workspace.json")),
            ("knot.db", staging.clone()),
        ] {
            zip.start_file(name, options)?;
            std::io::copy(&mut File::open(path)?, &mut zip)?;
        }
        let mut query = ws.db.prepare("SELECT DISTINCT sha256 FROM attachments")?;
        let hashes = query.query_map([], |r| r.get::<_, String>(0))?;
        for hash in hashes {
            let hash = hash?;
            let path = ws.asset_path(&hash)?;
            if hash_file(&path)? != hash {
                return Err("Cannot back up corrupt attachment".into());
            }
            zip.start_file(format!("assets/{}/{}", &hash[..2], hash), options)?;
            std::io::copy(&mut File::open(path)?, &mut zip)?;
        }
        zip.finish()?.sync_all()?;
        fs::rename(&tmp, dest)?;
        Ok(())
    })();
    let _ = fs::remove_file(staging);
    if outcome.is_err() {
        let _ = fs::remove_file(tmp);
    }
    outcome
}
pub fn restore(archive: &Path, parent: &Path) -> Result<PathBuf> {
    let root = parent.join(format!("restored-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root)?;
    let result = (|| -> Result<()> {
        let mut zip = ZipArchive::new(File::open(archive)?)?;
        if zip.len() > 100_000 {
            return Err("Archive has too many entries".into());
        }
        let mut total = 0u64;
        let mut seen = std::collections::HashSet::new();
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let name = entry.name().to_string();
            if !seen.insert(name.clone()) {
                return Err("Duplicate archive entry".into());
            }
            let allowed = name == "workspace.json" || name == "knot.db" || valid_asset(&name);
            if !allowed
                || entry.is_dir()
                || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            {
                return Err("Unsafe or unexpected archive entry".into());
            }
            total = total
                .checked_add(entry.size())
                .ok_or("Archive size overflow")?;
            if total > 20 * 1024 * 1024 * 1024u64 {
                return Err("Archive exceeds 20 GiB restore limit".into());
            }
            let target = root.join(&name);
            fs::create_dir_all(target.parent().ok_or("Invalid archive path")?)?;
            let mut out = File::create(target)?;
            let size = entry.size();
            let copied = std::io::copy(&mut entry.by_ref().take(size + 1), &mut out)?;
            if copied != size {
                return Err("Invalid archive entry size".into());
            }
            out.sync_all()?;
        }
        if !seen.contains("workspace.json") || !seen.contains("knot.db") {
            return Err("Incomplete Knot archive".into());
        }
        let manifest: Manifest = serde_json::from_slice(&fs::read(root.join("workspace.json"))?)?;
        if manifest.format_version != 1 {
            return Err("Unsupported backup version".into());
        }
        let ws = Workspace::open(root.clone())?;
        let mut q = ws
            .db
            .prepare("SELECT DISTINCT sha256,size FROM attachments")?;
        for asset in q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?)))? {
            let (hash, size) = asset?;
            let path = ws.asset_path(&hash)?;
            if fs::metadata(&path)?.len() != size || hash_file(&path)? != hash {
                return Err("Backup attachment failed size/hash validation".into());
            }
        }
        let violations: i64 =
            ws.db
                .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                    r.get(0)
                })?;
        if violations != 0 {
            return Err("Broken backup relationships".into());
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&root);
        return Err(e);
    }
    Ok(root)
}
fn valid_asset(name: &str) -> bool {
    let p: Vec<_> = name.split('/').collect();
    p.len() == 3
        && p[0] == "assets"
        && p[2].len() == 64
        && p[2]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && p[1] == &p[2][..2]
}
