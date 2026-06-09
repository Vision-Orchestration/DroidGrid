# DroidGrid Pro

**Multi-phone DroidCam controller with a full-stack web UI and optional Electron desktop app.**

---

## Quick Start

```bash
npm install
npm run dev           # web mode — open http://localhost:3000
```

## Electron Desktop App

```bash
npm run electron:dev   # starts backend + opens Electron window
```

## What's functional

| Feature | Detail |
|---|---|
| Camera fleet management | Add, edit, remove cameras with live inline editing |
| Connection test | Per-camera and bulk "Test All" button — real HTTP probe |
| Recording control | Start/Stop with live timer in nav + cell HUD |
| Snapshot | One JPEG filename per camera, saved to `snapDir` |
| Session settings | Label, person, repeat, naming pattern — saved to disk |
| Profiles | Save/load/delete named configurations — persisted to `~/.droidgrid/` |
| Live logs | Real backend log stream, colour-coded by level |
| Auto camera scan | Re-checks all enabled cameras every 30 s |

## Data persistence

Everything is stored in `~/.droidgrid/`:
- `cameras.json` — your camera list
- `profiles.json` — saved profiles
- `session.json` — current session state
- `server.log` — log history

## Directory structure

```
droidgrid-pro/
├── src/App.tsx          ← full React UI
├── server.ts            ← Express backend (all real APIs)
├── electron-main.cjs    ← Electron entry
├── package.json
└── vite.config.ts
```

## Part of Vision-Orchestration
