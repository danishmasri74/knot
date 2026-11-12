# Runs every check a release needs, and on success records which files they
# passed on, so `pnpm release` can skip repeating them for the same commit.
#
#   pnpm checks
#
# The record is the git tree hash of the working tree (tracked and untracked
# files, .gitignore respected). Committing exactly what was checked gives the
# commit that same tree, so the release recognises it. Any later edit changes
# the hash and the release runs the checks again.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
. (Join-Path $PSScriptRoot 'tree-hash.ps1')
try {
    $before = Get-WorkingTreeHash
    $checks = [ordered]@{
        'TypeScript'     = { pnpm check }
        'ESLint'         = { pnpm lint }
        'Frontend tests' = { pnpm test }
        'Rust tests'     = { cargo test --manifest-path src-tauri/Cargo.toml }
        'Clippy'         = { cargo clippy --manifest-path src-tauri/Cargo.toml }
    }
    foreach ($check in $checks.GetEnumerator()) {
        Write-Output ''
        Write-Output "== $($check.Key)"
        & $check.Value
        if ($LASTEXITCODE -ne 0) { throw "$($check.Key) failed (exit $LASTEXITCODE)." }
    }
    if ((Get-WorkingTreeHash) -ne $before) {
        Write-Output ''
        Write-Output 'All checks passed, but files changed while they ran, so nothing was recorded.'
        exit 0
    }
    Set-ChecksPassed $before
    Write-Output ''
    Write-Output 'All checks passed. pnpm release will skip them for a commit of exactly these files.'
} finally {
    Pop-Location
}
