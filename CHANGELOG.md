# Changelog

Every version of Crate, newest first. Written automatically by `scripts\sync.ps1`.
Versions are `major.minor.patch` - patch for tweaks and fixes, minor for new
features, major for a rebuild.

## 0.1.0 - 2026-07-28

Initial version. The existing single-file app, wrapped in a proper project
structure with version tracking and automatic GitHub sync.

- Added `crate.html` (the app, unchanged - 1280 lines)
- Added folder structure: `assets/`, `data/`, `docs/`, `scripts/`
- Added `scripts/sync.ps1` (version bump, changelog, commit, push)
- Added `scripts/setup-github.ps1` (one-time GitHub link)
- Added `CHANGELOG.md`, `VERSION`, `README.md`, `.gitignore`, `.gitattributes`
