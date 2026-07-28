# Crate — vinyl cataloguer

A single-file web app for cataloguing a record collection. Open `crate.html` in
any browser; there's nothing to install and no server to run.

## Layout

```
Source Docuemt/
├── crate.html          the app — HTML, CSS and JS in one file
├── VERSION             current version number
├── CHANGELOG.md        what changed in each version, newest first
├── README.md           this file
├── assets/
│   ├── css/            stylesheets, once they're split out of crate.html
│   ├── js/             scripts, once they're split out of crate.html
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

If you edit `crate.html` yourself in another editor, run the same script by hand
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

## Publishing the app on the web (optional)

GitHub Pages serves a repo as a website for free, but it looks for a file named
`index.html`. Rename `crate.html` to `index.html`, then turn on Pages in the
repo's Settings → Pages, and the app becomes a URL you can open on your phone.

## Recovering an old version

Every version is a git commit and a git tag, so nothing is ever lost:

```bash
git log --oneline
```

```bash
git show v0.1.0:crate.html > crate-0.1.0.html
```
