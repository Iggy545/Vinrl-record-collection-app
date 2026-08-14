# Changelog

Every version of Crate, newest first. Written automatically by `scripts\sync.ps1`.
Versions are `major.minor.patch` - patch for tweaks and fixes, minor for new
features, major for a rebuild.

## 0.12.40 - 2026-08-14 16:47

Show these in the crate: take a saved set to the Crate tab and tap through to each record

Open a saved set and there is a new button, Show these in the crate. It takes you to the
Crate tab showing only that set's tracks - so a tap on any of them opens the locator you
already had: shelf, position, the front-to-back ruler and the two records either side.

Switch to Sleeves and the same filter gives you the pull list as a wall of covers, which is
the view you want when you are actually pulling them.

It is precise about tracks, not just records: if a set uses two cuts off a record that has
eight tracks on it, you see those two and not the other six.

An orange bar across the top of the crate says which set you are looking at and how much of
it there is, because this is the one thing set on one tab that changes what another tab
shows, and a quietly half-empty crate reads as lost records. Show all on that bar, or Clear
filters, puts everything back. Renaming a set updates the bar, and deleting one turns the
filter off rather than leaving the crate filtered by a name that has gone.

- Modified `app.js` (+4631/-4545)
- Modified `index.html` (+2/-0)
- Modified `styles.css` (+15/-0)

## 0.12.39 - 2026-08-14 16:30

Set builder: a record never follows itself, so every join is a real mix

You mix from one deck to the other, and the same piece of vinyl cannot be on both. So the
next track in a set can never come off the record currently playing - not the other side,
not the next cut along. Every join is now between two different records.

This replaces the old let it run and flip the record moves, which described things you
cannot actually do with two turntables. It is a hard rule in the builder rather than a
preference, so nothing can outweigh it.

One consequence worth knowing: it is the number of sleeves that limits a set now, not the
number of tracks. Twelve tracks spread over three records still only makes a three-track
set. The Sets tab shows a sleeves count alongside usable and keyed, and warns you when a
shelf or genre is too thin to mix through - or when there is only one record in it, and so
nothing to mix into at all.

Sets saved before this change still open. If one of them has a same-record join in it, the
row now says so rather than calling it a move.

- Modified `app.js` (+66/-34)

## 0.12.38 - 2026-08-14 15:45

Save your sets: named, synced, backed up, and they survive the crate changing under them

Save this set names a set and puts it under Your sets at the top of the Sets tab, where you
can reopen, rename or delete it. Saved sets go into your JSON backup and sync to your other
device alongside your shelves.

A set keeps a reference to each track rather than a copy of it. Correct a BPM and every set
using that track shows the correction, and the running time is worked out fresh each time
you open one - so filling in durations later fixes the length of sets you saved weeks ago.

The trade is that a reference can go stale, so each one carries the track title as well as
its position. If a tracklist gets re-pulled from Discogs and shuffles, the set still finds
the right tune instead of confidently handing you the wrong one. If you delete a record or
rename a track, the set tells you how many have gone rather than quietly getting shorter,
and the rest still plays in order. Deleting a set never touches your records.

- Modified `app.js` (+235/-30)
- Modified `index.html` (+3/-1)
- Modified `styles.css` (+17/-0)

## 0.12.37 - 2026-08-14 15:32

Sets tab: build a set list along an energy curve, with a pull list

A fifth tab. Pick a shape - slow build, double peak, warm-up, closing set, peak time or
after hours - and Crate walks your collection along it, ordering records so the energy
follows the curve.

It knows these are records, not files. A Technics gives you plus or minus 8%, so a join
inside 6% is called a blend and anything past it a hard cut. Keys follow the same Camelot
rules as the filter. Two tracks off the same side in a row come up as let it run rather
than as a mix, going to the other side says flip the record, and it avoids sending you
back to a sleeve you have already put away. Underneath every set is a pull list: each
sleeve you need, in the order you will want it, with its shelf code and position.

Tracks with no BPM are left out and counted, because you cannot beatmatch what has not
been timed. The coverage figures at the top say what your crate can and cannot support
before you build anything.

Nothing is saved yet and nothing on your records changes - another go reshuffles, and the
whole set exports to CSV.

- Modified `app.js` (+450/-1)
- Modified `index.html` (+31/-0)
- Modified `styles.css` (+60/-1)

## 0.12.36 - 2026-08-14 15:16

Track energy 1-10: worked out from your own tempo bands, measured free from AcousticBrainz, or set by hand

Every track now shows how hard it hits. Until you say otherwise the number is derived from
the track's tempo, key and length - and from where that tempo sits among your other records
of the same genre, so fast for a dub record and fast for a hard house record are not the
same number. Nothing is stored while it is being worked out, so it re-reads itself as more
tempos go in. A slider on each track overrules it; reset hands it back.

Find tempo and key is now Find tempo, key and energy. The energy comes out of the same
AcousticBrainz response as the tempo, so it costs no extra look-up - but a track missing all
three now calls both sources, which makes the look-up slower on purpose. The review panel
names which source supplied what, and still writes nothing until you tick it.

Also: Energy low-high and Energy, then BPM sorts, and an energy bar on every track row.

- Modified `app.js` (+342/-29)
- Modified `index.html` (+3/-1)
- Modified `styles.css` (+31/-0)

## 0.12.35 - 2026-08-05 22:01

Sync setup copy no longer assumes the POS app; README describes the three-file split

The Setup panel's sync hint told the user to reuse "the same config and login as
your POS app", which reads as an instruction to anyone else setting Crate up from
scratch. It now leads with the step people actually get stuck on ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â the login has
to be created in the Firebase console first, because there is no sign-up path, so
a missing account surfaces as "wrong email or password". Reusing another app's
Firebase project is still mentioned, as an option rather than a requirement. The
iPad is gone from that line too; only a phone and a PC ever ran the app.

README.md still described Crate as a single file with "HTML, CSS and JS in one
file", stale since the v0.12.32 split. It now documents the three files, the
empty assets/css and assets/js placeholders, the versioned-asset cache busting
that keeps index.html and app.js from drifting apart, and what changes about
recovering an old version either side of the split.

- Modified `README.md` (+39/-14)
- Modified `index.html` (+4/-2)

## 0.12.34 - 2026-08-03 23:01

Fix the key filter collapsing to its chevron, so a key can be picked

The Any key dropdown in the BPM lane was rendering 18px wide on a desktop
window - all 25 options present, but no visible control, so there was no way
to choose a key and the harmonically-compatible tick had nothing to work
from. The wider the window, the narrower it got.

Cause: the global width:100% on inputs gave both BPM boxes a flex-basis of
the whole lane, so the row was always over-subscribed, while the key
select's inline flex:1.3 set its basis to 0. A basis-0 item contributes
nothing to shrink distribution, so it never got any width back and fell to
min-content.

The lane now sizes all three controls on the same terms, the BPM boxes take
88px, and the key select has a real basis so it drops to its own line on a
phone rather than sharing one three ways. Readable at every width from 320
to 1440.

- Modified `index.html` (+1/-1)
- Modified `styles.css` (+17/-1)

## 0.12.33 - 2026-08-03 22:45

Add a Test it button for the GetSongBPM API key in Setup

Mirrors the Discogs token test. Saves the typed key, then calls
api.getsong.co with a known track and reports what came back.

It reads the status and body rather than going through
fromGetSongBpm(), which returns null for every failure alike. That
separates the three states that otherwise look identical: a key that
has not been activated from its email link yet, a wrong key, and a
working key that simply had no data for the track.

- Modified `app.js` (+39/-0)
- Modified `index.html` (+2/-0)

## 0.12.32 - 2026-08-03 21:20

Split app.js out of index.html; version the asset URLs

- The script block is now app.js, byte-identical to what was inside the tag
  (170,246 bytes in and out). index.html is 293 lines of markup only.
- sync.ps1 stamps APP_VERSION into app.js, not index.html, and rewrites the
  app.js?v= and styles.css?v= query strings in the same pass. All three files
  are cached independently at max-age=600, so without that a fresh index.html
  could pull a stale app.js and the two would disagree about the markup.
- The update check read APP_VERSION out of the live index.html, which no
  longer holds it. It reads the app.js?v= reference instead: the authoritative
  pairing, and a far smaller download now index.html is markup only.
- Scan screen hint still promised the old camera behaviour (queues silently,
  no asking). Rewritten to match the picker. The help sheet was already done.

Verified against a fingerprint taken before the move: 107 global functions
unchanged, 11 sort orders identical in both views, DOM shape and styling
unchanged, no console errors. Version stamping proved end to end in a
throwaway repo, and the update check covered by 7 checks.

- Added `app.js` (+3507/-0)
- Modified `index.html` (+3/-3504)
- Modified `scripts/sync.ps1` (+24/-2)

## 0.12.31 - 2026-08-03 20:55

Pick the pressing on camera scans; label sort blanks-last; range-check looked-up tempos

- Camera scans no longer take Discogs first match silently. More than one hit
  parks the job as pick-one and opens the picker once the queue has drained,
  unless a sheet is already open. A single hit still files without
  interrupting. Help sheet updated.
- Label sort put unlabelled records at the top: the tilde sentinel does not
  work with localeCompare. Explicit blanks-last check in both views.
- A tempo from GetSongBPM or AcousticBrainz skipped the 40-300 range check the
  typed box enforces. inRange() now guards lookupTempoKey for both sources; a
  silly tempo is dropped, the key is kept.
- sync.ps1 takes .sync-hold (ship nothing this turn) and .sync-note (this
  message), both outside the repo so they are never committed.
- sync.ps1 commits via git commit -F, not -m. PowerShell 5.1 re-parses native
  command arguments, so a double quote in the message split it and git read
  the rest as pathspecs. That failed AFTER the version bump and staging, and
  said nothing, so this release was left staged and unpushed once already. A
  failed commit now also writes .sync-error for the next session to find.

Verified against the real code: 40 browser checks for the app changes, and the
commit path dry-run against the exact message that broke it.

- Modified `index.html` (+82/-21)
- Modified `scripts/sync.ps1` (+88/-7)

## 0.12.30 - 2026-08-03 11:49

Automatic sync - 2 files changed

- Modified `index.html` (+24/-4)
- Modified `styles.css` (+5/-0)

## 0.12.29 - 2026-08-03 11:41

Automatic sync - 2 files changed

- Modified `index.html` (+40/-2)
- Modified `styles.css` (+10/-2)

## 0.12.28 - 2026-08-03 11:33

Automatic sync - 1 file changed

- Modified `index.html` (+5/-11)

## 0.12.27 - 2026-08-03 11:26

Automatic sync - 1 file changed

- Modified `index.html` (+23/-0)

## 0.12.26 - 2026-08-03 11:16

Automatic sync - 2 files changed

- Modified `index.html` (+42/-399)
- Added `styles.css` (+403/-0)

## 0.12.25 - 2026-08-01 12:07

Automatic sync - 1 file changed

- Modified `index.html` (+32/-1)

## 0.12.24 - 2026-08-01 12:01

Automatic sync - 1 file changed

- Modified `index.html` (+40/-14)

## 0.12.23 - 2026-08-01 11:53

Automatic sync - 1 file changed

- Modified `index.html` (+8/-1)

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
