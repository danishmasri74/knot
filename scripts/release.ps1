# Builds, signs and publishes a Knot release to the public releases repository.
#
#   pnpm release 0.2.0                 full release
#   pnpm release 0.2.0-rc.1 -Prerelease  test release (not served as "latest")
#   pnpm release 0.2.0 -DryRun         everything except publishing; no clean-tree
#                                      or GitHub checks
#
# See docs/RELEASING.md for one-time setup. The Knot source repository is never
# pushed anywhere: gh uploads files to a release in the releases repository.
param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Version,
    [switch]$Prerelease,
    [switch]$DryRun,
    [switch]$SkipChecks,
    [switch]$SkipLocalUpdate,
    # Publish a test version (e.g. 0.2.0-rc.3) as the latest release so an
    # installed test build can update to it. Only for testing the updater.
    [switch]$TestLatest,
    [string]$NotesFile,
    [string]$PublicKeyPath
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
. (Join-Path $PSScriptRoot 'tree-hash.ps1')

function Step([string]$Text) { Write-Output ''; Write-Output "== $Text" }
function Fail([string]$Text) { throw "Release stopped: $Text" }
function Invoke-Checked([string]$Label, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { Fail "$Label failed (exit $LASTEXITCODE)." }
}
function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
function Write-Utf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}

$passwordWasSet = $false
$keyWasSet = $false
try {
    # ---------------------------------------------------------------- preflight
    Step "Preflight for Knot $Version"
    if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$') {
        Fail "'$Version' is not a version like 0.2.0 or 0.2.0-rc.1."
    }
    if ($Version.Contains('-') -and -not $Prerelease -and -not $DryRun -and -not $TestLatest) {
        Fail "$Version looks like a test version. Add -Prerelease, or -TestLatest to test the updater, or use a plain version."
    }
    if ($TestLatest -and $Prerelease) { Fail '-TestLatest and -Prerelease contradict each other.' }

    $config = Get-Content -LiteralPath 'scripts/release.config.json' -Raw | ConvertFrom-Json
    $repo = $config.repo
    $keyPath = [Environment]::ExpandEnvironmentVariables($config.keyPath)
    if (-not $DryRun -and ($repo -notmatch '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$' -or $repo -like 'OWNER/*')) {
        Fail "set the releases repository in scripts/release.config.json (currently '$repo')."
    }

    Invoke-Checked 'Version check' { node scripts/set-version.mjs --check $Version }

    # The Knot installer template is a modified copy of one Tauri version's
    # template; a CLI upgrade may change what the bundler passes to it.
    $templateBase = (Select-String -LiteralPath 'src-tauri/installer/knot.nsi' -Pattern 'based on Tauri ([0-9.]+)' | Select-Object -First 1).Matches[0].Groups[1].Value
    $cliVersion = ((pnpm -s tauri --version) -replace '[^0-9.]', '')
    if ($templateBase -ne $cliVersion) {
        Write-Warning "Installer template is based on Tauri $templateBase but the CLI is $cliVersion. Compare the new upstream installer.nsi with src-tauri/installer/tauri-$templateBase-installer.nsi.orig before releasing."
    }

    if (-not $NotesFile) { $NotesFile = "docs/releases/$Version.md" }
    if (-not (Test-Path -LiteralPath $NotesFile)) {
        Fail "release notes are missing. Write $NotesFile (a few short lines)."
    }
    $notes = (Get-Content -LiteralPath $NotesFile -Raw -Encoding UTF8).Trim()
    if (-not $notes) { Fail "$NotesFile is empty." }

    if (-not $DryRun) {
        $dirty = git status --porcelain
        if ($LASTEXITCODE -ne 0) { Fail 'git status failed.' }
        if ($dirty) { Fail 'the working tree has uncommitted changes. Commit or stash them so the release matches a commit.' }
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            Fail 'GitHub CLI is not installed. See docs/RELEASING.md, one-time setup.'
        }
        gh auth status | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'GitHub CLI is not signed in. Run: gh auth login' }
        gh release view "v$Version" --repo $repo | Out-Null
        if ($LASTEXITCODE -eq 0) { Fail "release v$Version already exists in $repo." }
    }

    # Signing key: an explicit environment variable wins, then the configured file.
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        if (-not (Test-Path -LiteralPath $keyPath)) {
            Fail "signing key not found at $keyPath. See docs/RELEASING.md, one-time setup."
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $keyPath -Raw).Trim()
        $keyWasSet = $true
    }
    if (-not $PublicKeyPath) { $PublicKeyPath = "$keyPath.pub" }
    if (-not (Test-Path -LiteralPath $PublicKeyPath)) {
        Fail "public key not found at $PublicKeyPath. It is written next to the private key by 'tauri signer generate'."
    }
    $publicKey = (Get-Content -LiteralPath $PublicKeyPath -Raw).Trim()
    # Installed copies trust only the key in tauri.conf.json; a release signed
    # with any other key would be rejected by every updater.
    $tauriConf = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($tauriConf.plugins.updater.pubkey -ne $publicKey) {
        Fail "the updater public key in src-tauri/tauri.conf.json does not match $PublicKeyPath."
    }
    if (-not $DryRun -and -not ($tauriConf.plugins.updater.endpoints -contains "https://github.com/$repo/releases/latest/download/latest.json")) {
        Fail "the updater endpoint in src-tauri/tauri.conf.json does not point at $repo."
    }
    if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        if (-not [Environment]::UserInteractive) {
            Fail 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not set and there is no console to ask for it.'
        }
        $secure = Read-Host -AsSecureString 'Signing key password'
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        $passwordWasSet = $true
    }

    # ------------------------------------------------------------------- checks
    if ($SkipChecks) {
        Step 'Checks skipped (-SkipChecks)'
    } elseif (Test-ChecksPassed (Get-WorkingTreeHash)) {
        # pnpm checks passed on exactly these files (see scripts/checks.ps1).
        Step 'Checks already passed for these exact files (pnpm checks)'
    } else {
        Step 'Checks'
        Invoke-Checked 'Checks' { & (Join-Path $PSScriptRoot 'checks.ps1') }
    }

    # -------------------------------------------------------------------- build
    Step 'Build and sign'
    # Only releases produce signed updater files; everyday builds
    # (pnpm update:running) need no key.
    $releaseConfig = [ordered]@{ bundle = [ordered]@{ createUpdaterArtifacts = $true } }
    $releaseConfigPath = Join-Path $projectRoot 'src-tauri/target/release-updater.conf.json'
    Write-Utf8 $releaseConfigPath ($releaseConfig | ConvertTo-Json -Depth 6)
    Invoke-Checked 'Tauri build' { pnpm tauri build --config $releaseConfigPath }

    $bundleDir = Join-Path $projectRoot 'src-tauri/target/release/bundle/nsis'
    $installerName = "Knot_${Version}_x64-setup.exe"
    $installer = Join-Path $bundleDir $installerName
    $signature = "$installer.sig"
    if (-not (Test-Path -LiteralPath $installer)) { Fail "the build did not produce $installerName." }
    if (-not (Test-Path -LiteralPath $signature)) { Fail "the build did not produce $installerName.sig. Is the signing key valid?" }
    if ((Get-Item -LiteralPath $signature).LastWriteTime -lt (Get-Item -LiteralPath $installer).LastWriteTime.AddMinutes(-1)) {
        Fail "$installerName.sig is older than the installer; it was not signed by this build."
    }

    # ----------------------------------------------------------------- manifest
    Step 'Release files'
    $outDir = Join-Path $projectRoot "src-tauri/target/release/release-out/$Version"
    if (Test-Path -LiteralPath $outDir) { Remove-Item -LiteralPath $outDir -Recurse -Force }
    New-Item -ItemType Directory -Path $outDir | Out-Null
    Copy-Item -LiteralPath $installer -Destination $outDir
    Copy-Item -LiteralPath $signature -Destination $outDir
    Copy-Item -LiteralPath $NotesFile -Destination (Join-Path $outDir 'notes.md')

    $sigText = (Get-Content -LiteralPath $signature -Raw).Trim()
    $assetBase = if ($repo -like 'OWNER/*') { 'https://github.com/OWNER/knot-releases' } else { "https://github.com/$repo" }
    $manifest = [ordered]@{
        version   = $Version
        notes     = $notes
        pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        platforms = [ordered]@{
            'windows-x86_64' = [ordered]@{
                signature = $sigText
                url       = "$assetBase/releases/download/v$Version/$installerName"
            }
        }
    }
    $manifestPath = Join-Path $outDir 'latest.json'
    Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 5)
    $installerHash = Get-Sha256 $installer
    Write-Output "Installer: $installerName  $([math]::Round((Get-Item $installer).Length / 1MB, 1)) MB"
    Write-Output "SHA-256:   $installerHash"
    Write-Output "Files:     $outDir"

    if ($DryRun) {
        Step 'Dry run: not published'
        Write-Output "Would run: gh release create v$Version --repo $repo --title 'Knot $Version' --notes-file notes.md $(if ($Prerelease) { '--prerelease ' })$installerName $installerName.sig latest.json"
        return
    }

    # ------------------------------------------------------------------ publish
    Step "Publish to $repo"
    $ghArgs = @('release', 'create', "v$Version", '--repo', $repo, '--title', "Knot $Version",
        '--notes-file', (Join-Path $outDir 'notes.md'),
        (Join-Path $outDir $installerName), (Join-Path $outDir "$installerName.sig"), $manifestPath)
    if ($Prerelease) { $ghArgs += '--prerelease' }
    Invoke-Checked 'gh release create' { gh @ghArgs }

    # ------------------------------------------------------------------- verify
    Step 'Verify download links'
    $tagUrl = "https://github.com/$repo/releases/download/v$Version"
    $remote = Invoke-RestMethod -UseBasicParsing -Uri "$tagUrl/latest.json"
    if ($remote.version -ne $Version) { Fail "published latest.json reports $($remote.version)." }
    if ($remote.platforms.'windows-x86_64'.signature -ne $sigText) { Fail 'published signature does not match the build.' }
    $downloaded = Join-Path $outDir 'downloaded-check.exe'
    Invoke-WebRequest -UseBasicParsing -Uri $remote.platforms.'windows-x86_64'.url -OutFile $downloaded
    if ((Get-Sha256 $downloaded) -ne $installerHash) { Fail 'downloaded installer does not match the build.' }
    Remove-Item -LiteralPath $downloaded
    Write-Output 'Tag links verified: latest.json, signature and installer match.'

    if (-not $Prerelease) {
        $latest = Invoke-RestMethod -UseBasicParsing -Uri "https://github.com/$repo/releases/latest/download/latest.json"
        if ($latest.version -ne $Version) { Fail "the updater endpoint still reports $($latest.version)." }
        Write-Output "Updater endpoint now serves $Version."
    } else {
        Write-Output 'Prerelease: the updater endpoint (releases/latest) is unchanged.'
    }

    # ------------------------------------------------------------- local update
    if (-not $SkipLocalUpdate) {
        Step 'Update the installed app on this PC'
        Invoke-Checked 'pnpm update:running' { pnpm update:running -SkipBuild }
    }
    Step "Knot $Version released"
} finally {
    if ($passwordWasSet) { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue }
    if ($keyWasSet) { Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue }
    Pop-Location
}
