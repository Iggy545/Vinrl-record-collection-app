# Changelog

Every version of Crate, newest first. Written automatically by `scripts\sync.ps1`.
Versions are `major.minor.patch` - patch for tweaks and fixes, minor for new
features, major for a rebuild.

## 0.8.0 - 2026-07-28 16:34

Drag spines in the flick-through rail to reorder a shelf

- Modified `index.html` (+121/-4)

## 0.7.0 - 2026-07-28 16:19

Drag records into your own order within a shelf, and import PositionInShelf

- Modified `index.html` (+136/-6)

## 0.6.0 - 2026-07-28 15:59

Rename the app to index.html so the site root serves it, not the README

- Modified `README.md` (+27/-11)
- Renamed `index.html`

## 0.5.0 - 2026-07-28 15:13

Sync the crate across devices via Firebase, same pattern as the POS app

- Modified `crate.html` (+332/-2)

## 0.4.2 - 2026-07-28 14:55

Never auto-commit collection exports or backups

- Modified `.gitignore` (+19/-1)

## 0.4.1 - 2026-07-28 14:19

Stop shelf tiles triggering the remove-shelf handler

- Modified `crate.html` (+7/-5)

## 0.4.0 - 2026-07-28 14:14

Show each shelf as its own crate tile, tap to filter and drag to reorder

- Modified `crate.html` (+139/-1)

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
