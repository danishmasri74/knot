use std::path::Path;

/// Compare the actual parent directory, not its spelling. Windows packaged-app
/// virtualization can expose the same directory through different resolved paths.
/// Resolving the child first still rejects links into an unrelated directory.
pub fn is_direct_child(child: &Path, parent: &Path) -> std::io::Result<bool> {
    let resolved = child.canonicalize()?;
    match resolved.parent() {
        Some(actual_parent) => same_file::is_same_file(actual_parent, parent),
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn containment_checks_identity_and_rejects_unrelated_parents() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("managed");
        let other = temp.path().join("elsewhere");
        fs::create_dir_all(base.join("Backups")).unwrap();
        fs::create_dir_all(other.join("Backups")).unwrap();
        assert!(is_direct_child(&base.join("Backups"), &base).unwrap());
        assert!(!is_direct_child(&other.join("Backups"), &base).unwrap());
        assert!(!is_direct_child(&base, &base).unwrap());
        assert!(is_direct_child(&base.join("missing"), &base).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_parent_case_alias_is_accepted() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("ManagedCase");
        fs::create_dir_all(base.join("Backups")).unwrap();
        let alias = temp.path().join("managedcase");
        assert!(is_direct_child(&base.join("Backups"), &alias).unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn redirected_backup_folder_outside_storage_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("managed");
        let target = temp.path().join("unrelated");
        std::fs::create_dir(&base).unwrap();
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("keep.txt"), b"unchanged").unwrap();
        let link = base.join("Backups");
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command",
                "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:KNOT_JUNCTION_LINK -Target $env:KNOT_JUNCTION_TARGET | Out-Null"])
            .env("KNOT_JUNCTION_LINK", &link)
            .env("KNOT_JUNCTION_TARGET", &target)
            .status().unwrap();
        assert!(status.success());
        assert!(!is_direct_child(&link, &base).unwrap());
        assert!(crate::managed_backups::list(&base).is_err());
        // Remove only the junction itself, never recurse through its target.
        std::fs::remove_dir(&link).unwrap();
        assert_eq!(
            std::fs::read(target.join("keep.txt")).unwrap(),
            b"unchanged"
        );
    }

    #[test]
    #[ignore = "Read-only check of an explicitly supplied existing Windows data folder"]
    fn installed_backup_directory_identity() {
        let base = std::path::PathBuf::from(std::env::var_os("KNOT_TEST_MANAGED_BASE").unwrap());
        assert!(is_direct_child(&base.join("Backups"), &base).unwrap());
        // Also exercise archive resolution without opening or changing the workspace.
        let entries = crate::managed_backups::list(&base).unwrap();
        println!(
            "Managed backup folder accepted; {} archives listed",
            entries.len()
        );
    }
}
