# Crate — handoff notes

Written 2026-07-28, at **v0.12.0**. Everything below is verified, not assumed.

## 1. What this is

**Crate** — a single-file vinyl cataloguing web app for one user (Iggy, `iggy545@gmail.com`).
It scans/looks up records on Discogs, stores a collection locally, and syncs across an
iPhone, an iPad and a Windows PC.

- **App:** `C:\Users\IGGY5\Claude\Projects\Vinyl Record App\Source Docuemt\index.html`
  — one file, ~2,400 lines, HTML + CSS + JS, no build step, no dependencies.
- **Live:** https://iggy545.github.io/Vinrl-record-collection-app/
- **Repo:** https://github.com/Iggy545/Vinrl-record-collection-app (**public** — required
  for GitHub Pages on a free plan)
- Note the repo name has a typo — `Vinrl`, not `Vinyl`. Paths are case-sensitive.
- The folder name is also misspelt — `Source Docuemt`. Left alone deliberately.

## 2. Architecture and decisions

### Storage
- `DB = { items:[], shelves:[], token:'', curr:'GBP' }` in `localStorage` under `crate.db`,
  via an async `store.get/set` abstraction (tries `window.storage`, then `localStorage`,
  then memory).
- `save()` is debounced 200ms and is the single mutation funnel; it also triggers a sync push.
- Sync settings live in **separate** localStorage keys: `crate.sync.{cfg,code,email,on,times,client}`.
  This is why the old backup missed them.

### Record shape
25 fields incl. `uid`, `id` (Discogs release id), `shelf`, **`slot`** (1-based position on its
shelf), `tracks[]` (with `bpm`/`key`), `media`/`sleeve` grades, `paid`, `barcode`, `low`.

### Firebase sync (v0.5.0)
Ported deliberately from the user's **POS app** at
`C:\Users\IGGY5\Claude\Projects\POS System\index.html` (see its "TEAM SYNC" section ~line 5446).
Same pattern: compat SDKs from gstatic CDN loaded on demand, email/password auth with LOCAL
persistence, **one Firestore doc per record**, last-write-wins, echo suppression via a
per-device client id, shadow-diff for outgoing changes, `enablePersistence` for offline.

- Crate writes to `workspaces/<code>/records` and `workspaces/<code>/meta/crate`.
- The POS uses `items`, `sales`, `meta/session` — **different names on purpose** so one
  Firebase project can host both. User said they'd prefer a **separate Firebase project**;
  full setup steps were given but it is **not known whether they completed it**.
- Config is pasted by the user at runtime; **no credentials in the source file**.
- Deliberately not synced: the Discogs token (per-device credential).

### Two ordering concepts
- `DB.shelves` array order = shelf order (drag the shelf tiles to change).
- `item.slot` = position within a shelf. Imported from the CSV's `PositionInShelf`.
- Sort option **"Shelf order — yours"** is first in the dropdown, therefore the **default**.

### Arranging (v0.10.0 — important design pivot)
Dragging was replaced as the *primary* interaction by **tap-to-pick-up, tap-to-place**,
because dragging a 26px spine on a phone was unusable and arrange mode had disabled rail
scrolling. Mouse dragging still works.
- Tap **arrange records** → tap a record (lifts, orange outline) → tap where it goes,
  or tap a **shelf tile** to move it to that shelf.
- `placeBefore()` handles cross-shelf placement at an exact position.
- Both shelves are always renumbered dense 1..n after any move.

### Build/release automation
`scripts/sync.ps1` — bumps `VERSION`, stamps `const APP_VERSION` into `index.html`,
prepends a `CHANGELOG.md` entry listing changed files with +/- line counts, commits,
tags annotated `vX.Y.Z`, pushes.
- Runs automatically via a **`Stop` hook** in
  `C:\Users\IGGY5\Claude\Projects\Vinyl Record App\.claude\settings.json`.
- **Manual runs can race the hook.** A rejected push is harmless — it self-heals next sync.

## 3. Two traps that cost a lot of time — do not rediscover these

### GitHub Pages silently stops deploying
`git push --follow-tags` (branch + tags in one push) **did not trigger the Pages build**.
Four releases sat in the repo while the live site served old code, with no error anywhere.
Fixed in v0.10.1: `sync.ps1` now pushes the branch, then the tags, as two commands.
- **Always verify a deploy landed**, don't assume:
```powershell
$u='https://iggy545.github.io/Vinrl-record-collection-app/'; $r=Invoke-WebRequest -Uri ($u+'?cb='+[guid]::NewGuid()) -Headers @{'Cache-Control'='no-cache'} -UseBasicParsing; ([regex]::Match($r.Content,"const APP_VERSION = '([^']*)'")).Groups[1].Value
```
- If it stalls again, `git commit --allow-empty -m "Nudge" ; git push origin main` wakes it.
- **Setup → bottom of page shows the running version.** If the user reports a feature not
  working, **ask what version that screen shows first.**

### `WebFetch` caches 15 min per URL
Use PowerShell `Invoke-WebRequest` with a `?cb=<guid>` cache-buster for deploy checks.

## 4. Status

### Done and live (v0.12.0)
- CSV import understanding the user's collection-app export (not a Discogs export):
  `AlbumTitle`, `DiscogsReleaseId`, `Tracklist`, `Tracklist with Artists`, `CatNo`, `Shelf`,
  `PositionInShelf`, `Price`, `Identifiers` (barcode), `Genres`, `Country`
- "Fill in from Discogs" — bulk backfill of artwork/prices for imported stubs, rate-limited,
  stoppable, preserves typed BPM/key
- Shelves as crate tiles: tap to filter, drag to reorder
- Record ordering within a shelf + moving between shelves (tap or drag)
- Firebase cross-device sync
- Backup/restore of **everything** incl. sync settings; accepts legacy backups
- Discogs search results picker — shows all matches, user chooses, marks "IN CRATE"
- Version stamping and display

### Verified clean at handoff
- Working tree clean, `0` commits unpushed, `HEAD == origin/main == 19739b8`
- `VERSION` = `0.12.0`, `APP_VERSION` = `0.12.0`, live site = `0.12.0`

### Known-open / offered but not built
1. **Camera scanning still auto-queues** and silently takes Discogs' first match. The picker
   was applied to the typed **Find** path only, deliberately (a dialog per sleeve would
   ruin batch scanning). Offered a "review these afterwards" flow — user hasn't answered.
2. **The POS app has the same first-connect sync bug** Crate had: `reconcile()` builds its
   shadow from local data so records never upload on a first connect to an empty workspace.
   Empty loop at `POS System/index.html:5672`. Offered to fix; user hasn't answered.
3. **Repo/folder name typos** (`Vinrl`, `Docuemt`) — offered to rename, declined/ignored.
4. Whether the user finished the **separate Firebase project** setup is unknown.
5. Sync has **never been tested against real Firebase** — only a stubbed Firestore.

## 5. Working agreements

- **Test before claiming done.** Drive the real code in the browser
  (`mcp__Claude_Browser__javascript_tool`), stub network calls (`fetchRelease`, `findRelease`,
  `window.firebase`) rather than skipping verification. Snapshot and restore
  `localStorage['crate.db']` around tests — it is the user's real data store.
- **Report failures plainly**, including bugs found in my own earlier work. Several were
  (shelf-tile `data-shelf` collision, slot off-by-one, restore self-overwrite, Pages deploys).
- Commit via `sync.ps1`, never raw `git commit`, so version/changelog/tag stay consistent.
- `-Bump minor` for features, default patch for fixes.
- British English in UI copy. Comments explain *why*, not *what*.
- Never commit collection data — `.gitignore` blocks `*.csv`/`*.json` and `data/*`.
  `crate-backup.json` contains the Discogs token and Firebase config.
