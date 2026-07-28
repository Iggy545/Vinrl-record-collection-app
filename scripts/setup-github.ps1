<#
.SYNOPSIS
    One-time: connect this folder to a GitHub repository and push it up.

.DESCRIPTION
    Create an EMPTY repository on github.com first (no README, no .gitignore,
    no licence - this folder already has them), then run this script with its
    URL. After this, scripts\sync.ps1 pushes automatically on every change.

.EXAMPLE
    .\scripts\setup-github.ps1 -RepoUrl https://github.com/yourname/crate.git

.EXAMPLE
    .\scripts\setup-github.ps1 -RepoUrl git@github.com:yourname/crate.git
#>
[CmdletBinding()]
param(
    # HTTPS or SSH clone URL of an empty GitHub repository.
    [Parameter(Mandatory = $true)]
    [string]$RepoUrl,

    # Name to record on commits. Defaults to whatever git already knows.
    [string]$UserName,

    # Email to record on commits. Defaults to whatever git already knows.
    [string]$UserEmail
)

$ErrorActionPreference = 'Continue'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo

git rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Initialising a git repository here first..."
    git init -b main | Out-Null
}

if ($UserName) { git config user.name $UserName }
if ($UserEmail) { git config user.email $UserEmail }

$who = git config user.name
$mail = git config user.email
if ([string]::IsNullOrWhiteSpace($who) -or [string]::IsNullOrWhiteSpace($mail)) {
    Write-Warning "Git has no name/email set. Re-run with -UserName 'Your Name' -UserEmail 'you@example.com'."
    exit 1
}

$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "Replacing existing origin ($existing) with $RepoUrl"
    git remote set-url origin $RepoUrl
}
else {
    git remote add origin $RepoUrl
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -eq 'HEAD' -or [string]::IsNullOrWhiteSpace($branch)) { $branch = 'main' }

Write-Host "Pushing '$branch' to $RepoUrl ..."
git push -u --follow-tags origin $branch
if ($LASTEXITCODE -ne 0) {
    Write-Warning @"
Push failed. Usual causes:
  * The GitHub repo isn't empty - delete its README and try again.
  * You aren't signed in. Install Git Credential Manager, or run:
        git push -u origin $branch
    once by hand and complete the browser sign-in it offers.
"@
    exit 1
}

Write-Host ""
Write-Host "Done. $repo is now linked to $RepoUrl."
Write-Host "From here on, changes are committed, changelogged and pushed automatically."
