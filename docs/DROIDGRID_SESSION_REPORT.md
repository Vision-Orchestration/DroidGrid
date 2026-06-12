# DroidGrid — Full Session Report

**Date:** 2026-06-09
**Environment:** Windows, Python 3.14, Node.js, Docker

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Directory Structure](#2-directory-structure)
3. [droidgrid_v2/ — Python CLI](#3-droidgrid_v2--python-cli)
4. [DroidGrid Pro/ — React + Express Web UI](#4-droidgrid-pro--react--express-web-ui)
5. [Infrastructure Files](#5-infrastructure-files)
6. [Backups](#6-backups)
7. [What Changed / Why](#7-what-changed--why)

---

## 1. Project Overview

**DroidGrid** is a multi-phone DroidCam controller that simultaneously streams, records, and snapshots from multiple Android phones running DroidCam over Wi-Fi MJPEG.

The project has two parallel codebases:

| Codebase | Stack | Purpose |
|---|---|---|
| `droidgrid_v2/` | Python 3 + OpenCV + NumPy | CLI/TUI grid with tkinter launcher |
| `DroidGrid Pro/` | React 19 + Express + Vite + Tailwind v4 | Web dashboard with REST API |

And two infrastructure backings:

| File | Purpose |
|---|---|
| `mediamtx.yml` | MediaMTX stream broker config (RTSP/WebRTC/HLS) |
| `docker-compose.yml` | ETSI NFV-style VNF stack deployment |

---

## 2. Directory Structure

```
DROIDGRIDD/
├── droidgrid_v2/                        # ← Python CLI (v2)
│   ├── droidgrid.py                     # Main: Camera class, Session, HUD, grid rendering
│   ├── launcher.py                      # tkinter graphical config window
│   ├── requirements.txt                 # opencv-python, numpy
│   ├── CHANGELOG.md
│   ├── LICENSE                          # MIT
│   └── .gitignore
│
├── DroidGrid Pro/                       # ← React + Express web app (v2.4.0-pro)
│   ├── server.ts                        # Express backend (429 lines)
│   │                                     #   - REST: cameras, session, profiles, recording, logs
│   │                                     #   - Addon loading system (manifest-based)
│   │                                     #   - MediaMTX integration (record start/stop via REST)
│   │                                     #   - ONVIF discovery subprocess
│   │                                     #   - Storage retention cleanup
│   ├── package.json                     # deps: React 19, Express, Vite 6, Tailwind v4, motion
│   ├── vite.config.ts                   # Vite + React + Tailwind v4 plugin
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                     # React entry
│       ├── index.css                    # Tailwind v4 theme (brand: #3ddc84, dark surfaces)
│       ├── App.tsx                      # Full 768-line SPA with 3 views:
│       │                                  #   - Dashboard (bento grid, stats, logs, profiles)
│       │                                  #   - Cameras (CRUD, test, recording controls)
│       │                                  #   - Settings (General, Session, Networking, Advanced)
│       └── components/
│           └── CameraCell.tsx           # WebRTC (WHEP) live video cell
│
├── mediamtx.yml                         # MediaMTX: 5 DroidCam sources, WebRTC on :8889, API on :9997
├── docker-compose.yml                   # VNF stack: ingest, decoder, api, ui
├── addons/                                # Addon plugins (loaded by server.ts)
│   ├── fern-inference/                   # FERN foot gesture recognition
│   │   ├── addon.json
│   │   ├── index.ts                      # TypeScript entry — spawns Python subprocess
│   │   └── inference.py                  # Python ONNX + MediaPipe inference loop
│   └── gridflow-bridge/                  # External data pipeline bridge
│       ├── addon.json
│       ├── index.ts                      # TypeScript entry — HTTP forwarding + sync
│       └── scripts/
│           └── convert.py               # JSON/CSV/Parquet data converter
├── ADDONS_CONTRIBUTE.md                  # Full addon developer guide
├── recording_assistant.py                # FERN v2 Guided Recording Assistant (tkinter)
├── recording_assistant_preview.html      # FERN Recording Assistant browser preview (HTML/Canvas)
├── DROIDGRID_FERN_MASTER.md             # Master architecture plan (17 sections)
├── DROIDGRID_SESSION_REPORT.md          # THIS FILE
│
├── .backups/
│   └── 20260607_212316/                 # Rollback snapshots of prior states
│       ├── droidgrid_cli_droidgrid.py
│       ├── droidgrid_cli_requirements.txt
│       ├── droidgrid_v2_droidgrid.py
│       ├── droidgrid_v2_launcher.py
│       ├── droidgrid_v2_requirements.txt
│       ├── pro_App.tsx
│       ├── pro_server.ts
│       ├── pro_vite.config.ts
│       ├── pro_tsconfig.json
│       ├── pro_main.tsx
│       ├── pro_index.css
│       ├── pro_package.json
│       ├── pro_electron-main.cjs
│       ├── DROIDGRID_FERN_MASTER.md
│       └── awesome-tui-designDESIGN.md
│
├── droidgrid_pro_final.zip              # Packaged DroidGrid Pro codebase
├── droidgrid-pro.zip                    # Another snapshot
├── awesome-tui-designDESIGN.md          # TUI design reference (Vercel/Linear aesthetic)
└── DroidGrid_Architecture_Proposal.pdf   # Architecture document
```

---

## 3. droidgrid_v2/ — Python CLI

### 3.1 `droidgrid.py` (981 lines)

The core Python application. Architecture:

```
Camera class (per-phone thread)
├── connect()          → cv2.VideoCapture MJPEG/RTSP stream
├── start()/stop()     → daemon thread for _capture_loop
├── _capture_loop()    → reads frames, freeze detection (MD5 hash), FPS counter, pushes to display + writer queue
├── start_recording()  → spawns _writer_loop thread
├── stop_recording()   → sends sentinel, joins thread
├── _writer_loop()     → adaptive FPS: buffers first 20 frames, measures actual fps, creates VideoWriter
│                         Prevents sped-up playback when camera delivers fewer frames than target
└── save_snapshot()    → saves current display frame as JPEG

Session class
├── make_video_path()  → {label}_{person}_{repeat}_{camera}.mp4
├── make_snapshot_path() → {label}_{person}_{repeat}_{camera}_{date}_{time}.jpg
└── auto_next_repeat() → increments r01 → r02 → etc.

DroidGrid class (main controller)
├── connect_all() / start_all() → parallel connection threads
├── start_recording() / stop_recording()
│   ├── Legacy mode: per-camera VideoWriter
│   └── MediaMTX mode: REST API to MediaMTX broker
├── take_snapshots()
├── _build_grid()      → 3-column grid of camera cells
├── run()              → cv2.imshow main loop with keyboard controls
└── Keyboard controls: R=Rec, S=Stop, T=Snap, G=Label, P=Person, N=Repeat, C=Reconnect, H=HUD, Q=Quit
```

Key features:
- **Freeze detection**: MD5 hash every 8th pixel, reconnect if identical for 60 frames
- **Adaptive VideoWriter FPS**: measures real camera fps from first 20 timestamps
- **InlinePrompt**: on-screen text input via keyboard (no terminal needed)
- **HUD overlay**: camera name, FPS health (green/amber/red), REC badge with blinking dot, per-camera timer, frame counter, drop counter
- **Auto-reconnect**: exponential back-off on dropped frames

### 3.2 `launcher.py` (884 lines)

tkinter graphical launcher that runs before the camera grid. Complete dark-themed UI:

```
DroidGridLauncher
├── ProfileStore      → ~/.droidgrid/profiles.json persistence
├── CameraRow         → one row: checkbox, name, IP, port, resolution dropdown, FPS spinner, Test button
├── Cameras section   → scrollable list, Add Camera, Test All
├── Session section   → Label, Person, Repeat, naming pattern, record/snapshot dirs
├── Profiles panel    → listbox + Load/Save As/Rename/Delete/Quick Save
└── Launch button     → validates, builds config, launches DroidGrid()
```

Colour palette (dark):
- BG: `#0a0a0a`, BG2: `#1a1a1a`, BG3: `#2a2a2a`
- ACCENT: `#0070f3` (blue), SUCCESS: `#00c853`, WARN: `#f5a623`, DANGER: `#ee0000`

When `droidgrid.py` is run directly, it spawns `launcher.py` as a subprocess.

### 3.3 Other files

- `requirements.txt`: `opencv-python>=4.8.0`, `numpy>=1.24.0`
- `.gitignore`: `__pycache__`, `recordings/`, `snapshots/`, IDE files
- `CHANGELOG.md`: v1.0.0 → v1.1.0 → v2.0.0
- `LICENSE`: MIT

---

## 4. DroidGrid Pro/ — React + Express Web UI

### 4.1 `server.ts` (429 lines)

Express backend with full REST API:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health check, version, camera counts, recording status |
| `/api/cameras` | GET/POST | List / Add camera |
| `/api/cameras/:id` | PUT/DELETE | Update / Remove camera |
| `/api/cameras/:id/test` | POST | Test single camera connection |
| `/api/cameras/test-all` | POST | Test all enabled cameras |
| `/api/cameras/discover` | POST | ONVIF subnet scan (spawns Python script) |
| `/api/recording/start` | POST | Start MediaMTX recording |
| `/api/recording/stop` | POST | Stop, auto-increment repeat counter |
| `/api/recording/status` | GET | Recording state + elapsed time |
| `/api/snapshot` | POST | Save JPEG from all online cameras |
| `/api/session` | GET/PUT | Read / update session state |
| `/api/profiles` | GET/POST | List / Save profile |
| `/api/profiles/:id` | PUT/DELETE | Update / Delete profile |
| `/api/profiles/:id/load` | POST | Load profile (restore cameras + session) |
| `/api/logs` | GET | Last 50 log entries |
| `/api/settings/commit` | POST | Log settings commit |
| `/api/addons` | GET | List loaded addons |

**Addon System** (built in):
- Loads addons from `addons/<id>/addon.json` + entry file
- Each addon gets `AddonContext` with `getCameras()`, `registerRoute()`, `log()`, `getConfig()`, `setConfig()`, `emit()`, `on()`
- Routes auto-prefixed with `/api/addons/<addonId>/`

**Persistent state files** (in `~/.droidgrid/`):
- `cameras.json` — camera list
- `profiles.json` — saved profiles
- `session.json` — current session state
- `addons/<id>.json` — per-addon config

**MediaMTX integration:**
- Recording start/stop via `http://localhost:9997/v3/config/paths/<name>/record/{start,stop}`
- WebRTC base URL: `http://localhost:8889`

**Storage retention:**
- Daily prune of `.mp4` files older than `RETENTION_DAYS` (default 30)

### 4.2 `src/App.tsx` (768 lines)

React SPA with three views:

**Dashboard** — Bento grid layout:
- Status hero: camera count, recording state, profiles count
- Quick actions: recording start/stop, snapshot, test all
- Camera grid status dots
- Saved profiles list
- Live log stream
- Session settings inline

**Cameras** — Full CRUD:
- Inline editing: name, IP, port, resolution, FPS
- Enable/disable toggle
- Test button per camera
- Recording controls
- Session settings
- Profiles management

**Settings** — 4 tabs:
- General: data directory, auto-check toggle
- Session: all session fields
- Networking: DroidCam port, server port, timeout
- Advanced: storage info, recent logs

**Components:**
- `CameraCell.tsx` — WebRTC (WHEP) video element with status overlays
- `BentoCard` — reusable bento grid card
- `StatusDot` — animated status indicator
- Profile detail modal
- Toast notifications

**State management:**
- Polls backend every 4 seconds (`setInterval(refresh, 4000)`)
- Local camera editing with optimistic updates
- Recording timer via `setInterval`

### 4.3 `src/index.css`

Tailwind v4 theme:
```css
--color-brand: #3ddc84;        /* Android green */
--color-surface-bg: #09090b;   /* near-black */
--color-surface-card: #18181b;
--color-surface-border: #27272a;
--color-text-muted: #a1a1aa;
--color-text-dim: #71717a;
```

Custom scrollbar, pulse animation.

### 4.4 Config files

- `package.json` — React 19, Express 4, Vite 6, Tailwind v4, Motion (framer-motion fork), Lucide icons
- `vite.config.ts` — React + Tailwind v4 plugin, gemini env var passthrough
- `tsconfig.json` — ES2022, bundler resolution, react-jsx

---

## 5. Infrastructure Files

### 5.1 `mediamtx.yml`

MediaMTX stream broker configuration:
- `rtspAddress: :8554`, `rtmpAddress: :1935`, `hlsAddress: :8888`, `webrtcAddress: :8889`
- REST API on `:9997`
- WebRTC with Google STUN
- 5 phone sources: `phone1`–`phone5` pointing to `192.168.137.10{1-5}:4747/mjpegfeed?1280x720`
- Recording enabled with 5-minute segments
- Template for ONVIF RTSP cameras

### 5.2 `docker-compose.yml`

ETSI NFV-style VNF stack:

| Service | Container | Function | Resources |
|---|---|---|---|
| `vnf-ingest` | `bluenviron/mediamtx:latest` | Stream broker (host network) | 1 CPU, 256MB |
| `vnf-decoder` | `python:3.11-slim` | FERN inference pipeline | 4 CPU, 3GB |
| `vnf-api` | Node.js Express | Control plane | 1 CPU, 512MB |
| `vnf-ui` | Nginx/Vite build | Static web UI | 0.5 CPU, 256MB |

Health checks, restart policies, resource limits per VNF.

### 5.3 `DROIDGRID_FERN_MASTER.md`

Comprehensive 17-section architecture plan:
- **Part I**: Phases 1–4 (MediaMTX broker, FFMPEG pass-through, WebRTC browser view, ONVIF IP camera support)
- **Part II**: NFV/VNF deployment (Docker Compose SFC, fault isolation, resource descriptors)
- **Part III**: Addon system (manifest format, TypeScript API, loader, catalogue of 7 planned addons)
- **Part IV**: FERN integration (inference pipeline, MediaPipe + ONNX, recording assistant)
- **Part V**: Alpha phase tasks (camera-ID flag experiment, dataset assembly, training commands)

---

## 6. FERN Recording Assistant

### 6.1 `recording_assistant.py` (735 lines)

Fullscreen tkinter app that auto-guides FERN gesture recording sessions with countdown, GO/REST signals, and auto-generated label JSONs.

**Architecture:**

```
RecordingAssistant
├── DroidGridClient   → REST integration to DroidGrid Pro backend (start/stop recording)
├── LabelTracker      → tracks exact frame ranges for each phase, emits label JSONs
├── Gesture flow:
│   IDLE → PRESTART (3s foot_hold)
│        → for each gesture (7 reps):
│            COUNTDOWN (3s "GET READY") → PERFORM (1.5s "GO!") → REST (1s "foot_hold")
│        → ROUND BREAK (30s between round 1 and 2)
│        → DONE (save label JSON)
└── Gesture drawings  → tkinter Canvas stick-figure lower-body animations per gesture
```

**Gesture sequence:**
- Round 1: `heel_tap, foot_lift, sideway_kick, forward_step, forward_kick, cross_front, flamingo_bend`
- Round 2: same in reverse order
- 7 reps per gesture, 30s break between rounds

**Label JSON format:**
```json
{
  "video_file": "p12_c3_20260428_143000.mp4",
  "subject_id": "p12",
  "camera_id": 0,
  "fps": 30,
  "total_frames": 9450,
  "generator": "recording_assistant_v1",
  "gesture_order": ["heel_tap", "foot_lift", ...],
  "droidgrid": {},
  "segments": [
    {"gesture": "foot_hold", "start_frame": 0, "end_frame": 89},
    {"gesture": "heel_tap", "start_frame": 90, "end_frame": 134},
    ...
  ]
}
```

**CLI usage:**
```powershell
python recording_assistant.py --subject p12
python recording_assistant.py --subject p12 --no_droidgrid
python recording_assistant.py --list_gestures
```

**Visual design:** Fullscreen dark theme (`#0a0a0a` bg) with:
- Left panel: gesture name, Canvas stick-figure drawing, text cue
- Right panel: state label (amber countdown/green GO/blue REST), big countdown timer, progress bar
- Phase colours: amber (`#d97706`) → green (`#16a34a`) → blue (`#1d4ed8`) → purple break (`#7c3aed`)
- SPACE to start, ESC to quit

### 6.2 `recording_assistant_preview.html` (337 lines)

Browser-based HTML/Canvas preview of the same recording assistant flow. Same gesture sequence, same timing model. Features:

- Canvas-drawn stick figure lower body per gesture (7 poses + neutral)
- Phase state machine identical to Python version
- Speed multiplier: 1× real time, 4× fast, 10× demo
- Keyboard shortcuts: SPACE = start
- Dark theme matching the Python tkinter version

---

## 7. Backups

Directory `.backups/20260607_212316/` contains pre-modification snapshots of:
- `droidgrid_cli_droidgrid.py` — original single-file CLI version
- `droidgrid_v2_droidgrid.py` — prior state of v2 droidgrid.py
- `droidgrid_v2_launcher.py` — prior state of launcher.py
- `droidgrid_v2_requirements.txt`
- `droidgrid_cli_requirements.txt`
- `pro_App.tsx`, `pro_server.ts`, `pro_vite.config.ts`, `pro_tsconfig.json`, `pro_main.tsx`, `pro_index.css`, `pro_package.json`, `pro_electron-main.cjs`
- `DROIDGRID_FERN_MASTER.md`
- `awesome-tui-designDESIGN.md`

---

## 7. What Changed / Why

### Addon System built in this session:

1. **Created `addons/` directory** with two complete addons:
   - **`fern-inference/`** — FERN gesture recognition: spawns Python subprocess running MediaPipe skeleton extraction + ONNX inference. Routes: `GET /status`, `POST /start`, `POST /stop`, `GET /config`, `PUT /config`. Emits `fern:gesture` events to the bus.
   - **`gridflow-bridge/`** — External data pipeline bridge: periodic HTTP sync of camera state to a configurable GridFlow endpoint. Routes: `GET /status`, `POST /sync`, `GET /config`, `PUT /config`, `POST /export`. Includes `scripts/convert.py` for JSON/CSV/Parquet conversion.

2. **Extended `server.ts`** with addon management API:
   - `GET /api/addons` — list loaded addons
   - `GET /api/addons/available` — scan the filesystem for all addon manifests (loaded or not)
   - `POST /api/addons/:id/load` — load an addon at runtime
   - `POST /api/addons/:id/unload` — unload + `destroy()` an addon
   - `POST /api/addons/:id/reload` — unload then reload
   - `POST /api/addons/:id/enable` — re-enable and load a disabled addon
   - `POST /api/addons/:id/disable` — disable + unload (persists to `~/.droidgrid/addons_disabled.json`)
   - Each addon gets its own config file at `~/.droidgrid/addons/<id>.json`

3. **Added "Extensions" tab** in `App.tsx` — full VS Code-style extension management UI:
   - Lists all available addons from filesystem scan
   - Per-addon card: name, version, author, description, status badges (loaded/enabled), action buttons (Load/Unload/Enable/Disable)
   - Live status via `StatusDot` component
   - Re-fetches every 10 seconds
   - Built-in "How to Install Addons" guide section with directory structure and API reference

4. **Wrote `ADDONS_CONTRIBUTE.md`** — comprehensive 12-section developer guide:
   - Architecture overview with lifecycle diagram
   - Quick start ("Hello World" addon)
   - Full manifest reference with config schema
   - Addon API reference: `getCameras()`, `registerRoute()`, `log()`, `getConfig()`, `setConfig()`, `emit()`, `on()`
   - Permissions system reference
   - Configuration & persistence guide
   - Event system with built-in events table
   - Python subprocess addon pattern (stdout JSON protocol)
   - Best practices, troubleshooting, and complete example

### Changes made in this session (2026-06-09):

1. **Rewrote `droidgrid_v2/droidgrid.py`** — Complete rewrite from ~400 lines to 981 lines:
   - Added `Camera` class with threaded capture, freeze detection, adaptive FPS recording
   - Added `Session` class with naming pattern tokens
   - Added `DroidGrid` controller with keyboard-driven UI
   - Added `InlinePrompt` for on-screen text input
   - Added `_draw_cell_hud()` / `_draw_top_bar()` for rich HUD overlay
   - MediaMTX mode support (REST API start/stop)
   - `_safe_path()` to prevent file overwrites

2. **Wrote `droidgrid_v2/launcher.py`** — New 884-line tkinter GUI:
   - Full dark theme with Vercel/Linear aesthetic
   - Camera row editor with IP, port, resolution, FPS, test button
   - Profile management (save/load/rename/delete)
   - Session settings and output directories
   - Persistence to `~/.droidgrid/profiles.json`

3. **Rewrote `DroidGrid Pro/server.ts`** — From ~200 lines to 429 lines:
   - Added camera CRUD endpoints
   - Added MediaMTX recording integration
   - Added snapshot endpoint
   - Added profiles management (save/load/delete)
   - Added addon loading system
   - Added storage retention cleanup
   - Added ONVIF discovery subprocess

4. **Rewrote `DroidGrid Pro/src/App.tsx`** — From ~350 lines to 768 lines:
   - Full 3-view SPA (Dashboard, Cameras, Settings)
   - Bento grid dashboard with real-time stats
   - Inline camera editing with CRUD
   - Session management with real-time sync
   - Profile management with modal detail view
   - Toast notifications, loading screen

5. **Rewrote `DroidGrid Pro/src/components/CameraCell.tsx`** — New WebRTC (WHEP) video component

6. **Rewrote `DroidGrid Pro/src/index.css`** — Tailwind v4 theme

7. **Updated `mediamtx.yml`** — Added 5 phone sources, WebRTC, API, recording config

8. **Updated `docker-compose.yml`** — Full VNF stack with health checks, resource limits, ONVIF template

9. **Created `.backups/20260607_212316/`** — Pre-change snapshots of all modified files

### Why:
- Single-file CLI was unscalable — extracted into Camera/Session/DroidGrid classes
- Direct code editing for config was user-hostile — built launcher GUI
- CLI-only was limiting — built full React web dashboard
- No persistence — added `~/.droidgrid/` JSON file state
- No profile system — added named profiles with save/load
- No MediaMTX integration — added REST delegation for recording
- No WebRTC — added WHEP client component
- No addon system — built manifest-based plugin architecture
- No Docker — added VNF stack with health checks and resource limits

---

## How to Launch

### Python CLI (with launcher):
```powershell
cd droidgrid_v2
pip install -r requirements.txt
python launcher.py
# Or: python droidgrid.py  (launches launcher automatically)
```

### Web UI (development):
```powershell
cd "DroidGrid Pro"
npm install
npm run dev    # starts Express + Vite at http://localhost:3000
```

### Docker (full stack):
```powershell
docker compose up -d
# UI: http://localhost:80
# API: http://localhost:3000
# MediaMTX: rtsp://localhost:8554, WebRTC: http://localhost:8889
# MediaMTX API: http://localhost:9997/v3
```

### MediaMTX standalone:
```powershell
docker run --rm -d --name mediamtx --network host -v ./mediamtx.yml:/mediamtx.yml bluenviron/mediamtx:latest
```
