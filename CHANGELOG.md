# Changelog

Every version of Crate, newest first. Written automatically by `scripts\sync.ps1`.
Versions are `major.minor.patch` - patch for tweaks and fixes, minor for new
features, major for a rebuild.

## 0.12.22 - 2026-08-01 11:48

Automatic sync - 1 file changed

- Modified `index.html` (+35/-4)

## 0.12.21 - 2026-08-01 11:43

Automatic sync - 1 file changed

- Modified `index.html` (+38/-4)

## 0.12.20 - 2026-08-01 02:58

Automatic sync - 1 file changed

- Modified `index.html` (+31/-5)

## 0.12.19 - 2026-08-01 02:41

Automatic sync - 1 file changed

- Modified `index.html` (+23/-10)

## 0.12.18 - 2026-08-01 02:23

Automatic sync - 1 file changed

- Modified `index.html` (+19/-3)

## 0.12.17 - 2026-08-01 02:19

Automatic sync - 1 file changed

- Modified `index.html` (+101/-11)

## 0.12.16 - 2026-08-01 02:11

Automatic sync - 1 file changed

- Modified `index.html` (+49/-4)

## 0.12.15 - 2026-08-01 01:56

Automatic sync - 1 file changed

- Modified `index.html` (+33/-2)

## 0.12.14 - 2026-08-01 01:49

Automatic sync - 1 file changed

- Modified `index.html` (+16/-3)

## 0.12.13 - 2026-08-01 01:38

Automatic sync - 1 file changed

- Modified `index.html` (+69/-13)

## 0.12.12 - 2026-08-01 01:26

Automatic sync - 1 file changed

- Modified `index.html` (+139/-2)

## 0.12.11 - 2026-07-30 16:06

Automatic sync - 1 file changed

- Modified `index.html` (+21/-0)

## 0.12.10 - 2026-07-30 01:56

Automatic sync - 1 file changed

- Modified `index.html` (+61/-11)

## 0.12.9 - 2026-07-30 01:44

Automatic sync - 1 file changed

- Modified `index.html` (+71/-17)

## 0.12.8 - 2026-07-30 01:16

Automatic sync - 1 file changed

- Modified `index.html` (+61/-1)

## 0.12.7 - 2026-07-30 01:07

Automatic sync - 1 file changed

- Modified `index.html` (+196/-5)

## 0.12.6 - 2026-07-29 01:28

Automatic sync - 1 file changed

- Modified `index.html` (+18/-6)

## 0.12.5 - 2026-07-29 01:00

Automatic sync - 1 file changed

- Modified `index.html` (+203/-1)

## 0.12.4 - 2026-07-28 23:47

Automatic sync - 1 file changed

- Modified `index.html` (+65/-8)

## 0.12.3 - 2026-07-28 23:23

Automatic sync - 1 file changed

- Modified `index.html` (+24/-1)

## 0.12.2 - 2026-07-28 23:02

Automatic sync - 1 file changed

- Modified `index.html` (+166/-4)

## 0.12.1 - 2026-07-28 22:24

Add handoff notes for picking the project up in a new session

- Added `docs/HANDOFF.md` (+128/-0)

## 0.12.0 - 2026-07-28 18:18

Show every Discogs match when you search, and let you pick the pressing

- Modified `index.html` (+99/-1)

## 0.11.0 - 2026-07-28 18:11

Back up settings as well as records, and stop restore overwriting itself

- Modified `index.html` (+63/-6)

## 0.10.1 - 2026-07-28 18:00

Push branch and tags separately so GitHub Pages actually rebuilds

- Modified `scripts/sync.ps1` (+6/-1)

## 0.10.0 - 2026-07-28 17:54

Tap to pick up a record and tap to place it, so arranging works on touch

- Modified `index.html` (+97/-11)

## 0.9.2 - 2026-07-28 17:37

Label the two arrange buttons distinctly and show the app version in Setup

- Modified `index.html` (+17/-7)
- Modified `scripts/sync.ps1` (+13/-0)

## 0.9.1 - 2026-07-28 17:19

Allow arranging without picking a shelf first, so records can be dragged onto a shelf from the all-shelves view

- Modified `index.html` (+71/-25)

## 0.9.0 - 2026-07-28 17:03

Drop a record onto a shelf tile to move it between shelves

- Modified `index.html` (+92/-6)

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
