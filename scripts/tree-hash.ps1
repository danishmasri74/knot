# Shared by checks.ps1 and release.ps1: which files the checks last passed on.
# Dot-source from the project root.
$ChecksPassedPath = 'src-tauri/target/checks-passed.txt'

# The git tree hash of the working tree as it is now, without touching the
# real index: a temporary copy of the index is used.
function Get-WorkingTreeHash {
    $index = Join-Path ([IO.Path]::GetTempPath()) ('knot-index-' + [guid]::NewGuid().ToString('N'))
    $gitIndex = (git rev-parse --git-path index).Trim()
    if (Test-Path -LiteralPath $gitIndex) { Copy-Item -LiteralPath $gitIndex -Destination $index }
    $previous = $env:GIT_INDEX_FILE
    try {
        $env:GIT_INDEX_FILE = $index
        git -c core.safecrlf=false add -A
        if ($LASTEXITCODE -ne 0) { throw 'git add failed while hashing the working tree.' }
        $tree = (git write-tree).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $tree) { throw 'git write-tree failed.' }
        return $tree
    } finally {
        $env:GIT_INDEX_FILE = $previous
        Remove-Item -LiteralPath $index -Force -ErrorAction SilentlyContinue
    }
}

function Set-ChecksPassed([string]$Tree) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $ChecksPassedPath) -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path (Get-Location) $ChecksPassedPath), $Tree)
}

function Test-ChecksPassed([string]$Tree) {
    if (-not (Test-Path -LiteralPath $ChecksPassedPath)) { return $false }
    return ((Get-Content -LiteralPath $ChecksPassedPath -Raw).Trim() -eq $Tree)
}
