<#
.SYNOPSIS
    Version-bumps, changelogs, commits and pushes the Crate app.

.DESCRIPTION
    Run manually, or automatically via the Claude Code Stop hook in
    ..\..\.claude\settings.json.

    On each run it:
      1. Checks whether anything actually changed (exits quietly if not).
      2. Bumps VERSION (patch by default).
      3. Prepends an entry to CHANGELOG.md listing every file that changed
         since the previous version, with +/- line counts.
      4. Commits everything.
      5. Pushes to the 'origin' remote if one is configured.

    It never throws on failure — a failed push leaves the commit in place
    locally and prints a warning, so a network blip can't block your work.

    Two optional files sit in the parent folder of the repo, outside it, so
    they are never committed:

      .sync-hold  If present, the run exits immediately and ships nothing.
                  Its contents, if any, are printed as the reason. Use it to
                  keep unfinished work off the live site across a turn; the
                  next run without it releases everything at once.

      .sync-note  Its contents become the commit subject and changelog entry
                  instead of "Automatic sync". Deleted once used, so it can
                  never mislabel a later release.

.EXAMPLE
    .\scripts\sync.ps1 -Message "Add sleeve condition grading"

.EXAMPLE
    .\scripts\sync.ps1 -Bump minor -Message "New stats view"

.EXAMPLE
    .\scripts\sync.ps1 -Auto -Quiet        # what the Claude Code hook runs
#>
[CmdletBinding()]
param(
    # Summary line recorded in the changelog and used as the commit subject.
    [string]$Message,

    # Which part of the semantic version to increment.
    [ValidateSet('patch', 'minor', 'major', 'none')]
    [string]$Bump = 'patch',

    # Commit locally but don't push.
    [switch]$NoPush,

    # Non-interactive mode: generate the message from the diff.
    [switch]$Auto,

    # Suppress informational output (errors still print).
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'

function Write-Info([string]$Text) {
    if (-not $Quiet) { Write-Host $Text }
}

# ── locate the repo ──────────────────────────────────────────────────────
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo

$insideRepo = git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Not a git repository: $repo. Run scripts\setup-github.ps1 first."
    exit 0
}

# ── the hold and note files ──────────────────────────────────────────────
# Both live in the parent of the repo, deliberately: they are working-state,
# they must never be committed, and .gitignore can't be trusted to catch a
# file the hook itself creates.
$outside = Split-Path -Parent $repo
$holdFile = Join-Path $outside '.sync-hold'
$noteFile = Join-Path $outside '.sync-note'

# Held: the hook fires but ships nothing, so a turn can leave half-finished
# work in index.html without it reaching the live site. Nothing is lost —
# the next unheld run picks up everything that accumulated meanwhile.
if (Test-Path $holdFile) {
    $why = ''
    try { $why = (Get-Content $holdFile -Raw -ErrorAction Stop).Trim() } catch { }
    if ($why) { Write-Info "Sync held: $why" }
    else { Write-Info "Sync held by $holdFile - delete it to resume shipping." }
    exit 0
}

# ── anything to do? ──────────────────────────────────────────────────────
$dirty = git status --porcelain
if ([string]::IsNullOrWhiteSpace(($dirty -join ''))) {
    Write-Info "No changes to sync."
    exit 0
}

# ── stage everything, then read the change set back ──────────────────────
git add -A | Out-Null

$nameStatus = @(git diff --cached --name-status)
$numStat = @(git diff --cached --numstat)

# file path -> "+12/-3"
$counts = @{}
foreach ($row in $numStat) {
    $bits = $row -split "`t"
    if ($bits.Count -ge 3) {
        $added = $bits[0]
        $removed = $bits[1]
        $path = $bits[2]
        if ($added -eq '-') {
            $counts[$path] = 'binary'
        }
        else {
            $counts[$path] = "+$added/-$removed"
        }
    }
}

$labels = @{
    'A' = 'Added'; 'M' = 'Modified'; 'D' = 'Deleted'
    'R' = 'Renamed'; 'C' = 'Copied'; 'T' = 'Type changed'
}

$lines = @()
foreach ($row in $nameStatus) {
    $bits = $row -split "`t"
    if ($bits.Count -lt 2) { continue }

    $code = $bits[0].Substring(0, 1)
    $path = $bits[-1]

    # Housekeeping files the script itself touches — not worth listing.
    if ($path -in @('CHANGELOG.md', 'VERSION')) { continue }

    $label = $labels[$code]
    if (-not $label) { $label = 'Changed' }

    $detail = $counts[$path]
    if ($detail) { $lines += "- $label ``$path`` ($detail)" }
    else { $lines += "- $label ``$path``" }
}

if ($lines.Count -eq 0) {
    $lines = @('- Housekeeping (version and changelog only)')
}

# ── bump the version ─────────────────────────────────────────────────────
$versionFile = Join-Path $repo 'VERSION'
$current = '0.0.0'
if (Test-Path $versionFile) {
    $raw = (Get-Content $versionFile -Raw).Trim()
    if ($raw -match '^\d+\.\d+\.\d+$') { $current = $raw }
}

$parts = $current -split '\.'
$major = [int]$parts[0]; $minor = [int]$parts[1]; $patch = [int]$parts[2]

switch ($Bump) {
    'major' { $major++; $minor = 0; $patch = 0 }
    'minor' { $minor++; $patch = 0 }
    'patch' { $patch++ }
}
$next = "$major.$minor.$patch"

# ── build the changelog entry ────────────────────────────────────────────
# A -Message on the command line wins; otherwise .sync-note is what a turn
# leaves behind to say what it actually did. Without it every entry reads
# "Automatic sync - 3 files changed", which makes the changelog useless for
# finding when a behaviour changed.
$usedNote = $false
if ([string]::IsNullOrWhiteSpace($Message) -and (Test-Path $noteFile)) {
    try {
        $note = (Get-Content $noteFile -Raw -ErrorAction Stop).Trim()
        if (-not [string]::IsNullOrWhiteSpace($note)) { $Message = $note; $usedNote = $true }
    }
    catch { }
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    $fileCount = $lines.Count
    $noun = 'files'
    if ($fileCount -eq 1) { $noun = 'file' }
    if ($Auto) { $Message = "Automatic sync - $fileCount $noun changed" }
    else { $Message = "Update - $fileCount $noun changed" }
}

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$entry = "## $next - $stamp`r`n`r`n$Message`r`n`r`n" + ($lines -join "`r`n") + "`r`n"

$changelogFile = Join-Path $repo 'CHANGELOG.md'
$header = @(
    '# Changelog',
    '',
    'Every version of Crate, newest first. Written automatically by ``scripts\sync.ps1``.',
    'Versions are ``major.minor.patch`` - patch for tweaks and fixes, minor for new',
    'features, major for a rebuild.',
    ''
) -join "`r`n"

if (Test-Path $changelogFile) {
    $existing = Get-Content $changelogFile -Raw
    $marker = $existing.IndexOf('## ')
    if ($marker -ge 0) {
        $head = $existing.Substring(0, $marker)
        $tail = $existing.Substring($marker)
        $body = $head + $entry + "`r`n" + $tail
    }
    else {
        $body = $existing.TrimEnd() + "`r`n`r`n" + $entry
    }
}
else {
    $body = $header + "`r`n" + $entry
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($changelogFile, $body, $utf8)
[System.IO.File]::WriteAllText($versionFile, "$next`r`n", $utf8)

# Stamp the version into the app itself, so a device can be asked which
# build it is running. Without this a stale cached page is indistinguishable
# from a current one.
$appFile = Join-Path $repo 'index.html'
if (Test-Path $appFile) {
    $app = [System.IO.File]::ReadAllText($appFile)
    $stamped = [regex]::Replace($app, "const APP_VERSION = '[^']*';", "const APP_VERSION = '$next';", 1)
    if ($stamped -ne $app) {
        [System.IO.File]::WriteAllText($appFile, $stamped, $utf8)
        Write-Info "Stamped v$next into index.html"
    }
}

# ── commit ───────────────────────────────────────────────────────────────
# The message goes via a file, never `git commit -m "$Message"`. Windows
# PowerShell 5.1 re-parses a native command's arguments, so a double quote
# anywhere in the message splits it and git reads the remainder as pathspecs:
#   error: pathspec 'one and opens the picker...' did not match any file(s)
# The whole release then fails while VERSION, CHANGELOG.md and index.html
# have already been bumped and staged — v0.12.31's work sat uncommitted and
# unpushed exactly this way, and nothing said so. -F takes the bytes as they
# are: no quoting, no length limit, no newline mangling.
$subject = ($Message -split "`r?`n")[0]
$rest = $Message.Substring([Math]::Min($subject.Length, $Message.Length)).TrimStart("`r", "`n")
$commitText = "v$next - $subject"
if ($rest) { $commitText += "`r`n`r`n$rest" }

$msgFile = Join-Path ([System.IO.Path]::GetTempPath()) ("crate-commit-" + [guid]::NewGuid().ToString('N') + '.txt')
[System.IO.File]::WriteAllText($msgFile, $commitText, $utf8)

try {
    git add -A | Out-Null
    git commit -F $msgFile | Out-Null
    if ($LASTEXITCODE -ne 0) {
        # Loud, not just a warning: with -Quiet on the Stop hook nobody sees
        # stderr, which is how the failure above went unnoticed for a whole
        # turn. A file on disk survives for the next session to trip over.
        $why = "Commit of v$next FAILED at $(Get-Date -Format 'yyyy-MM-dd HH:mm'). " +
               "The version bump and staging already happened, so 'git status' in $repo " +
               "shows the work staged and uncommitted. Fix, commit, then delete this file."
        [System.IO.File]::WriteAllText((Join-Path $outside '.sync-error'), $why, $utf8)
        Write-Warning $why
        exit 0
    }
}
finally {
    Remove-Item -LiteralPath $msgFile -Force -ErrorAction SilentlyContinue
}

# Got here, so any previous failure is history.
Remove-Item -LiteralPath (Join-Path $outside '.sync-error') -Force -ErrorAction SilentlyContinue
Write-Info "Committed v$next - $subject"

# Consumed, not kept: a note left lying around would silently re-label the
# next unrelated release with the previous turn's message.
if ($usedNote) { Remove-Item -LiteralPath $noteFile -Force -ErrorAction SilentlyContinue }

# Annotated, not lightweight - 'git push --follow-tags' below ignores
# lightweight tags, so the version markers would never reach GitHub.
# Subject only, and via -m on a single line with no quotes to mangle: the
# full text is already on the commit.
git tag -f -a "v$next" -m "v$next" | Out-Null

# ── push ─────────────────────────────────────────────────────────────────
if ($NoPush) {
    Write-Info "Skipped push (-NoPush)."
    exit 0
}

$origin = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($origin)) {
    Write-Info "No 'origin' remote yet - committed locally only. Run scripts\setup-github.ps1 to connect GitHub."
    exit 0
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()

# Branch and tags go up as two separate pushes, not one --follow-tags push.
# Combined pushes were repeatedly failing to trigger the GitHub Pages
# build, leaving the live site stale while the repo was up to date.
git push origin $branch 2>&1 | ForEach-Object { Write-Info $_ }
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Push to origin failed - the commit is saved locally. It'll go up on the next successful sync."
    exit 0
}
git push --tags origin 2>&1 | ForEach-Object { Write-Info $_ }

Write-Info "Pushed v$next to origin/$branch."
exit 0
