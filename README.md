# Crate — vinyl cataloguer

A no-build web app for cataloguing a record collection. Three static files, no
dependencies, no bundler — there's nothing to install and no server to run.

**Live:** https://iggy545.github.io/Vinrl-record-collection-app/

Or open `index.html` straight off the disk in any browser — it works the same
either way, apart from the camera OCR, which needs a real `http://` origin
because browsers block workers and wasm on `file://`.

## Layout

```
Source Docuemt/
├── index.html          markup only — ~290 lines
├── app.js              the whole application
├── styles.css          the whole stylesheet
├── VERSION             current version number
├── CHANGELOG.md        what changed in each version, newest first
├── README.md           this file
├── assets/
│   ├── css/            unused — styles.css sits at the root
│   ├── js/             unused — app.js sits at the root
│   ├── img/            artwork, icons, screenshots
│   └── fonts/          for self-hosting the faces currently pulled from Google Fonts
├── data/               collection exports, seed data, backups worth keeping
├── docs/               notes, ideas, design decisions
└── scripts/
    ├── sync.ps1            commit + changelog + push
    └── setup-github.ps1    one-time GitHub link
```

It was a single `index.html` until v0.12.32, when the CSS and JS were split out
into their own files. It's still deliberately no-build and module-free — that's
what makes it portable and what lets any version be recovered as plain text.

### Cache busting

All three files are served with `max-age=600` and cached independently, so
`index.html` references the other two with a version query string —
`app.js?v=0.12.34`, `styles.css?v=0.12.34`. `sync.ps1` rewrites both in the same
pass that stamps `APP_VERSION` into `app.js`, which is what guarantees a freshly
loaded `index.html` can only ever pull the `app.js` released alongside it.

`APP_VERSION` lives in `app.js`. If it ever moves, `sync.ps1` has to change in
the same commit or version stamping breaks silently.

## How versioning works

Every sync bumps the version in `VERSION` and writes a `CHANGELOG.md` entry
listing exactly which files changed and by how many lines. Versions are
`major.minor.patch`:

| Part  | When it goes up          |
|-------|--------------------------|
| patch | tweaks, fixes, tidying   |
| minor | a new feature            |
| major | a rebuild or big rework  |

`patch` is the default. To bump differently:

```bash
powershell -ExecutionPolicy Bypass -File "scripts/sync.ps1" -Bump minor -Message "Added stats view"
```

## Automatic GitHub sync

Changes made through Claude Code are committed, changelogged and pushed
automatically when Claude finishes a turn — the `Stop` hook in
`../.claude/settings.json` runs `scripts/sync.ps1 -Auto`.

If you edit any of the three app files yourself in another editor, run the same
script by hand to push them:

```bash
powershell -ExecutionPolicy Bypass -File "scripts/sync.ps1" -Message "Describe what you changed"
```

### First-time setup

1. Create an **empty** repository on github.com — no README, no `.gitignore`,
   no licence.
2. Run, with your own repo URL:

```bash
powershell -ExecutionPolicy Bypass -File "scripts/setup-github.ps1" -RepoUrl https://github.com/YOURNAME/crate.git
```

After that first push, everything is automatic.

## The published site

GitHub Pages serves this repo at
https://iggy545.github.io/Vinrl-record-collection-app/ — Settings → Pages, from
`main` at the root. Pages serves `index.html` for that address, which is why the
app is named that; before the rename the root showed this README instead.

Every push republishes it automatically, a minute or so behind the commit.

On a phone, open the link in Safari and use **Share → Add to Home Screen**. It
then behaves like an installed app, and storage on a real `https://` origin is
far more durable than opening the file off the device.

## Recovering an old version

Every version is a git commit and a git tag, so nothing is ever lost:

```bash
git log --oneline
```

```bash
git show v0.5.0:index.html > crate-0.5.0.html
```

Two renames to know about when reaching back:

- Before **v0.6.0** the file was called `crate.html`, so for those tags ask for
  that name instead — `git show v0.1.0:crate.html`. `git log --follow index.html`
  walks the history across the rename.
- Before **v0.12.32** everything was inside `index.html`, so a single `git show`
  of that path gives you a complete, runnable app. From v0.12.32 on you need all
  three files, and the `?v=` query strings in `index.html` will point at that
  version — which is exactly what you want when checking one out.

```bash
git show v0.12.34:app.js > app.js
```
