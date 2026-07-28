# Changelog

Every version of Crate, newest first. Written automatically by `scripts\sync.ps1`.
Versions are `major.minor.patch` - patch for tweaks and fixes, minor for new
features, major for a rebuild.

## 0.3.0 - 2026-07-28 13:57

Import tracklists, Discogs IDs, shelves and prices from collection-app CSV exports

- Modified `crate.html` (+93/-14)

## 0.2.0 - 2026-07-28 13:46

Add 'Fill in from Discogs' so CSV imports get artwork and tracklists

- Modified `crate.html` (+64/-2)

## 0.1.2 - 2026-07-28 13:27

Use annotated version tags so they reach GitHub

- Modified `scripts/sync.ps1` (+3/-5)

## 0.1.1 - 2026-07-28 13:18

Check out native line endings on Windows

- Modified `.gitattributes` (+3/-2)

## 0.1.0 - 2026-07-28

Initial version. The existing single-file app, wrapped in a proper project
structure with version tracking and automatic GitHub sync.

- Added `crate.html` (the app, unchanged - 1280 lines)
- Added folder structure: `assets/`, `data/`, `docs/`, `scripts/`
- Added `scripts/sync.ps1` (version bump, changelog, commit, push)
- Added `scripts/setup-github.ps1` (one-time GitHub link)
- Added `CHANGELOG.md`, `VERSION`, `README.md`, `.gitignore`, `.gitattributes`
