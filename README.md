# Crate — vinyl cataloguer

A single-file web app for cataloguing a record collection. There's nothing to
install and no server to run.

**Live:** https://iggy545.github.io/Vinrl-record-collection-app/

Or open `index.html` straight off the disk in any browser — it works the same
either way.

## Layout

```
Source Docuemt/
├── index.html          the app — HTML, CSS and JS in one file
├── VERSION             current version number
├── CHANGELOG.md        what changed in each version, newest first
├── README.md           this file
├── assets/
│   ├── css/            stylesheets, once they're split out of index.html
│   ├── js/             scripts, once they're split out of index.html
│   ├── img/            artwork, icons, screenshots
│   └── fonts/          self-hosted fonts (currently loaded from Google Fonts)
├── data/               collection exports, seed data, backups worth keeping
├── docs/               notes, ideas, design decisions
└── scripts/
    ├── sync.ps1            commit + changelog + push
    └── setup-github.ps1    one-time GitHub link
```

The app is deliberately still one file — that's what makes it portable. The
`assets/` folders are there for when it outgrows that.

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

If you edit `index.html` yourself in another editor, run the same script by hand
to push it:

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

Before v0.6.0 the file was called `crate.html`, so for those tags ask for that
name instead — `git show v0.1.0:crate.html`. `git log --follow index.html`
walks the history across the rename.
