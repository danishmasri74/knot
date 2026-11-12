# Releasing Knot

Releases are published as files on a public, code-free GitHub repository. The Knot source repository has no remote and is never pushed. Design and rationale: [UPDATER-INSTALLER-PLAN.md](UPDATER-INSTALLER-PLAN.md).

## One-time setup

1. **GitHub CLI.** Install and sign in:

   ```
   winget install GitHub.cli
   gh auth login
   ```

2. **Releases repository.** Create a free GitHub organization (on github.com: **+ → New organization**), then a public repository `knot-releases` in it with only a README. In the repository settings turn off Issues, Wiki, Discussions and Projects. Use GitHub's private `noreply` commit email.

   Put the repository in `scripts/release.config.json`, e.g. `"repo": "knot-app/knot-releases"`.

3. **Signing key.** Generate the updater key with a password you keep in your password manager:

   ```
   pnpm tauri signer generate -w "%USERPROFILE%\.knot\knot-updater.key"
   ```

   This writes `knot-updater.key` (private) and `knot-updater.key.pub` (public). The release script reads the public key from the `.pub` file and embeds it in each release build, so the two always match. Copy both files and the password to offline storage, such as a USB drive. **If the private key or its password is lost, installed copies of Knot can no longer accept updates.** If either leaks, someone else could sign updates. `.gitignore` refuses `*.key` files as a guard, but the key belongs outside the repository.

## Each release

1. **Pick the version.**
   - Bump the minor version (0.2 → 0.3) when `CURRENT_SCHEMA` in `src-tauri/src/migrations.rs` or the workspace/archive format changed since the last release, because older builds reject newer databases.
   - Bump the patch version (0.2.0 → 0.2.1) otherwise.
   - Test releases use a suffix: `0.3.0-rc.1`.
2. **Set it everywhere:** `pnpm version:set 0.3.0`. `pnpm version:set --check` prints all four places.
3. **Write notes** in `docs/releases/0.3.0.md`: at most about 8 short lines written for users. Knot shows them in Settings → Updates. Start from `docs/releases/UNRELEASED.md`, where each user-visible change is noted as it's made, then leave that file with only its heading.

Between releases the version stays at the last release; bump it only when releasing.
4. **Run `pnpm checks`, then commit** the version bump, notes and any remaining work. The script refuses to publish from a working tree with uncommitted changes. If `pnpm checks` passed on exactly the committed files, the release skips the checks instead of running them again (any later edit makes it run them).
5. **Release:**

   ```
   pnpm release 0.3.0
   ```

   For a test release that the updater does not offer to anyone:

   ```
   pnpm release 0.3.0-rc.1 -Prerelease
   ```

   The script:
   - runs the checks, unless `pnpm checks` already passed on exactly these files;
   - builds and signs the installer;
   - writes `latest.json`;
   - uploads the installer, its `.sig` and `latest.json` with `gh release create`;
   - downloads them back to verify the version, signature and installer hash;
   - runs `pnpm update:running -SkipBuild` so this PC runs the released build.

   It asks for the key password unless `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set.

To test the in-app updater end to end, install a test build, then publish the next test version as the latest release without updating this PC: `pnpm release 0.2.0-rc.3 -TestLatest -SkipLocalUpdate`. The installed build then finds it in Settings → Updates. Every updater-enabled copy sees whatever is latest, so do this only before you've shared a build, or follow it with a real release.

Options: `-DryRun` builds everything into `src-tauri/target/release/release-out/<version>/` without checking the working tree or publishing. `-SkipChecks` skips the test suite. `-SkipLocalUpdate` leaves the installed app alone. `-NotesFile <path>` uses other notes.

## Addresses

- Updater endpoint (newest non-prerelease): `https://github.com/<repo>/releases/latest/download/latest.json`
- One release's files: `https://github.com/<repo>/releases/download/v<version>/<file>`

GitHub's `latest` link skips prereleases, so `-Prerelease` builds can be tested by their tag link without being offered to anyone.

## Removing a bad release

Delete it on GitHub (or `gh release delete v<version> --repo <repo> --cleanup-tag`). The `latest` link falls back to the previous release. Copies that already updated keep the bad version until a newer release ships, so fix forward with a new patch version.

## Installer

The Windows installer uses Knot's own NSIS template, `src-tauri/installer/knot.nsi`. Its artwork is in `src-tauri/installer/*.bmp`; regenerate it after an identity change with `node scripts/create-installer-art.mjs`. Before upgrading the Tauri CLI, compare its new `installer.nsi` with `src-tauri/installer/tauri-<version>-installer.nsi.orig` and carry the `KNOT:` changes over. The release script warns when the versions differ. Behaviour and test record: [UPDATER-INSTALLER-PLAN.md](UPDATER-INSTALLER-PLAN.md#3-installer-nsis).
