# DROIDGRIDD — Complete Codebase Report & Overhaul Directive

> **Generated:** 2025-06-11  
> **Audience:** AI Agent (OpenCode / Claude Code)  
> **Purpose:** Full codebase documentation + actionable overhaul plan  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Code Map](#2-architecture--code-map)
3. [Process Flows](#3-process-flows)
4. [Current Stage Analysis](#4-current-stage-analysis)
5. [Fixes Already Applied](#5-fixes-already-applied)
6. [Remaining Problems & Bugs](#6-remaining-problems--bugs)
7. [Technical Debt & Anti-Patterns](#7-technical-debt--anti-patterns)
8. [Critical Issues by Severity](#8-critical-issues-by-severity)
9. [Documentation Drift](#9-documentation-drift)
10. [Overhaul Directive — Push Beyond Roadmap](#10-overhaul-directive--push-beyond-roadmap)
    - [Phase 1: Hardening (Day 1-3)](#phase-1-hardening)
    - [Phase 2: Architecture (Day 4-7)](#phase-2-architecture)
    - [Phase 3: Features Beyond Roadmap (Day 8-14)](#phase-3-features-beyond-roadmap)
    - [Phase 4: Production Readiness (Day 15-21)](#phase-4-production-readiness)
    - [Phase 5: AI-Native Evolution (Day 22-30)](#phase-5-ai-native-evolution)
11. [Execution Instructions for AI Agent](#11-execution-instructions-for-the-ai)

---

## 1 · Project Overview

**DROIDGRIDD** is a multi-camera human-motion capture and gesture-recognition system. It records subjects performing a sequence of foot/leg gestures (heel tap, foot lift, sideway kick, forward step, forward kick, cross front, flamingo bend) from multiple phone cameras simultaneously, produces labeled datasets, and optionally runs real-time FERN (Foot Emotion Recognition Network) inference on the streams.

### Core Capabilities

| Capability | Description |
|------------|-------------|
| Multi-camera capture | 3-5 phone cameras via IP Webcam / DroidCam HTTP MJPEG streams |
| Gesture recording assistant | Fullscreen tkinter UI that guides subjects through 14-gesture × 7-rep sessions |
| Real-time inference | MediaPipe pose extraction → ONNX FERN v2 model → gesture classification |
| MediaMTX streaming | RTSP + WebRTC + HLS streaming via bluenviron/MediaMTX |
| Label generation | Per-camera JSON with segment-level frame and wall-clock timestamps |
| Docker VNF stack | 4-container deployment: ingest, decoder, API, UI |
| Electron desktop | Cross-platform desktop wrapper |
| Addon system | Plugin architecture with EventEmitter bus |
| ONVIF discovery | Auto-discover IP cameras on the network |

### Technology Stack

- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + motion (framer-motion) + Vite
- **Backend:** Express.js + TypeScript (run via tsx)
- **Desktop:** Electron (CJS main process, ESM renderer)
- **Streaming:** MediaMTX (RTSP :8554, WebRTC :8889, API :9997)
- **Inference:** Python 3.11 + OpenCV + ONNX Runtime + MediaPipe
- **Recording:** Python 3.11 + tkinter (recording_assistant.py)
- **Infrastructure:** Docker Compose, Nginx reverse proxy

### Project Structure (Simplified)

```
DROIDGRIDD/
├── droidgrid.py                        # Legacy v1 — standalone OpenCV grid
├── recording_assistant.py              # Gesture recording GUI (v1.2, 901 lines)
├── docker-compose.yml                  # VNF stack orchestrator
├── mediamtx.yml                        # MediaMTX stream broker config
├── DroidGrid Pro/                      # Modern web-based DroidGrid
│   ├── server.ts                       # Express backend (674 lines)
│   ├── src/
│   │   ├── App.tsx                     # React SPA (1074 lines)
│   │   ├── main.tsx                    # Entry point
│   │   ├── index.css                   # Tailwind config
│   │   └── components/
│   │       └── CameraCell.tsx          # WebRTC WHEP player
│   ├── Dockerfile.api                  # Container (BROKEN)
│   ├── Dockerfile.ui                   # Nginx container
│   ├── Dockerfile.decoder              # Python inference container
│   ├── electron-main.cjs               # Electron wrapper
│   ├── nginx.conf                      # Reverse proxy
│   ├── scripts/
│   │   └── discover_onvif.py           # ONVIF discovery script
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── droidgrid_v2/                       # Legacy v2 — with tkinter launcher
│   ├── droidgrid.py                    # OpenCV grid controller
│   ├── launcher.py                     # Tkinter configuration GUI
│   └── requirements.txt
├── addons/
│   ├── fern-inference/                 # FERN gesture recognition addon
│   │   ├── inference.py               # Python inference engine
│   │   ├── index.ts                    # TypeScript addon entry
│   │   ├── addon.json                  # Manifest
│   │   └── requirements.txt
│   └── gridflow-bridge/               # External data pipeline bridge
│       ├── index.ts
│       ├── addon.json
│       └── scripts/convert.py          # JSON/CSV/Parquet converter
└── .backups/                           # Pre-patch backups
```

---

## 2 · Architecture & Code Map

### 2.1 · Recording Pipeline

```
Phone Camera (HTTP MJPEG)
        │
        ▼
MediaMTX (RTSP :8554, WebRTC :8889, Recording :9997)
        │
        ├──► recording_assistant.py (tkinter GUI)
        │       │  State machine: IDLE → SYNC_WAIT → PRESTART →
        │       │  COUNTDOWN → PERFORM → REST → BREAK → DONE
        │       │  Produces: per-camera JSON label files
        │       │  API: POST /api/recording/start|stop|status
        │       │
        └──► FernInferenceAddon (index.ts)
                │  Spawns: inference.py
                │  Events: fern:gesture on addonEventBus
                │
                └──► inference.py (Python)
                        MediaPipe → FERN ONNX → JSON events
```

### 2.2 · Backend API (server.ts)

| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/api/health` | Server + MediaMTX health | ✅ |
| GET/POST/PUT/DELETE | `/api/cameras` | CRUD camera config | ✅ |
| POST | `/api/cameras/test-all` | Stream connectivity probe | ✅ |
| POST | `/api/cameras/discover` | ONVIF discovery | ✅ |
| POST | `/api/recording/start` | Start session recording | ✅ |
| GET | `/api/recording/status` | Recording state + cameras | ✅ |
| POST | `/api/recording/stop` | Stop + return file paths | ✅ |
| GET | `/api/recording/files` | List recorded files | ✅ |
| GET/PUT | `/api/session` | Session config CRUD | ✅ |
| GET/POST/PUT/DELETE | `/api/profiles` | Profile CRUD | ✅ |
| GET | `/api/addons` | List loaded addons | ✅ |
| GET/POST | `/api/addons/available` | Scan filesystem for addons | ✅ |
| POST | `/api/addons/:id/load\|unload\|reload\|enable\|disable` | Addon lifecycle | ✅ |
| GET/PUT | `/api/addons/:id/config` | Per-addon config | ✅ |

### 2.3 · Frontend (App.tsx)

| Tab | Purpose | Features |
|-----|---------|----------|
| **Dashboard** | Live monitoring | WebRTC video grid, recording state, timer, recent logs |
| **Cameras** | Camera management | CRUD rows, test button, live preview toggle, ONVIF discover |
| **Extensions** | Addon management | Load/unload/enable/disable, config editor, status |
| **Settings** | Session config | Subject ID, camera list, profile save/load/rename |

### 2.4 · Addon System Architecture

```
server.ts
  └── addonEventBus (EventEmitter instance)
        │  Events: fern:gesture, addon:loaded, addon:unloaded,
        │          addon:error, recording:start, recording:stop
        │
        ├── FernInferenceAddon
        │     ├── subscribes: recording:start → startInference()
        │     ├── subscribes: recording:stop  → stopInference()
        │     └── emits:      fern:gesture
        │
        └── GridFlowBridgeAddon
              ├── subscribes: fern:gesture → forwardEvent()
              └── emits:      (none — outbound HTTP only)
```

### 2.5 · Docker Stack

```
┌──────────┐     RTSP      ┌─────────────┐
│  Phone   │──────────────►│ vnf-ingest  │
│ Camera   │  HTTP MJPEG   │ (MediaMTX)  │
└──────────┘               │ :8554/8889  │
                            └──────┬──────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
            ┌────────────┐ ┌──────────┐ ┌────────────┐
            │vnf-decoder │ │ vnf-api  │ │  vnf-ui    │
            │(inference) │ │(Express) │ │  (Nginx)   │
            │ :8700      │ │ :3000    │ │  :8080     │
            └────────────┘ └──────────┘ └────────────┘
```

---

## 3 · Process Flows

### 3.1 · Recording Session Flow

```
1. User launches recording_assistant.py --subject p12 --cameras phone1,phone2,phone3
2. Fullscreen tkinter window opens with neutral stick figure
3. State: IDLE — user presses SPACE
4. State: SYNC_WAIT
   ├── POST /api/recording/start → returns {ok, session_id}
   ├── Poll GET /api/recording/status every 100ms until recording:true
   │   └── Timeout: 5s, warns if exceeded
   └── WAIT sync_delay_sec (default 1.0s) for MediaMTX buffer flush
5. State: PRESTART — "STARTING IN..." countdown (3s) labeled as foot_hold
6. For each of 14 gestures × 7 rounds:
   a. State: COUNTDOWN — 3s countdown, labeled foot_hold
   b. State: PERFORM — 6s gesture window, labeled with gesture name
   c. State: REST — 3s rest, labeled foot_hold
   d. After each gesture: _save_checkpoint()
7. State: BREAK — 10s rest between rounds
8. State: DONE
   ├── POST /api/recording/stop → returns {files: {name: path}}
   ├── GET /api/recording/files → returns actual MediaMTX paths
   ├── Save one JSON per camera
   ├── Clean up checkpoints
   └── Display summary
```

### 3.2 · Inference Flow (FERN)

```
1. User activates FernInferenceAddon from Extensions tab
2. Addon subscribes to recording:start / recording:stop events
3. On recording start:
   a. Spawns: python inference.py --rtsp_url rtsp://localhost:8554/phone1 ...
   b. inference.py connects to RTSP stream via OpenCV
   c. Skips sync_offset_sec frames (default 4.0s = sync_delay + pre_start)
   d. Main loop: read frame → MediaPipe pose → extract lower body → normalize
      → buffer window_size frames → FERN ONNX inference → smooth → emit
   e. Emits JSON lines: {gesture, confidence, stream_frame, ...}
4. index.ts reads stdout via readline, parses JSON, emits on addonEventBus
5. GridFlowBridgeAddon (if loaded) forwards events to external endpoint
```

### 3.3 · Label JSON Output

```json
{
  "video_file":     "/recordings/phone1/2025-06-10_14-30-00-000.mp4",
  "subject_id":     "p12",
  "camera_id":      0,
  "nominal_fps":    30,
  "total_frames":   17340,
  "segments": [
    {
      "gesture":      "foot_hold",
      "start_frame":  0,    "end_frame":  29,
      "start_sec":    0.0,  "end_sec":    1.0,  "duration_sec": 1.0
    },
    {
      "gesture":      "heel_tap",
      "start_frame":  210,  "end_frame":  254,
      "start_sec":    7.0,  "end_sec":    8.5,  "duration_sec": 1.5
    }
  ],
  "sync_note": "Frame numbers anchored to MediaMTX confirmation + sync_delay",
  "generator": "recording_assistant_v1.2"
}
```

---

## 4 · Current Stage Analysis

### What Works (Stable)

| Component | Confidence | Notes |
|-----------|-----------|-------|
| MediaMTX streaming | ✅ High | RTSP ingest from 5 phones, WebRTC playback |
| recording_assistant.py v1.2 | ✅ High | Full state machine, multi-tracker, checkpoints, wall-clock |
| server.ts core API | ✅ High | Camera CRUD, session/profiles, logs |
| App.tsx basic UI | ✅ High | 4-tab navigation, camera management, settings |
| Addon loading/unloading | ✅ High | Dynamic import, lifecycle hooks |
| FERN inference.py | ✅ Medium | Real-time gesture detection works |
| Label JSON generation | ✅ High | Per-camera files with wall-clock anchors |
| sync_delay (fix A) | ✅ Applied | Polls recording status before tracker start |
| file paths on stop (fix B) | ✅ Applied | Queries MediaMTX after stop |
| multi-camera JSON (fix C) | ✅ Applied | One tracker + JSON per camera |
| checkpoint saves (fix D) | ✅ Applied | After each gesture completion |
| wall-clock anchors (fix E) | ✅ Applied | start_sec, end_sec, duration_sec in segments |
| AddonEventBus wiring | ✅ Applied | Functional EventEmitter-based bus |
| Addon enable/disable | ✅ Applied | Endpoints exist |
| Dockerfile.decoder | ✅ Applied | Python inference container |
| App.tsx live video | ✅ Applied | WebRTC grid + camera tab preview |
| ONVIF discovery UI | ✅ Applied | Button + modal in cameras tab |

### What Partially Works

| Component | Status | Issue |
|-----------|--------|-------|
| Electron wrapper | ⚠️ Fragile | Depends on global `npx` + `tsx`, no fallback |
| Docker vnf-api | ❌ Broken | Dockerfile.api builds vite frontend but can't run server |
| GridFlow bridge | ⚠️ Untested | fire-and-forget HTTP, no retry, no auth |
| ONVIF discovery script | ⚠️ Untested | Silent failure if script missing or network unreachable |
| FERN inference framing | ⚠️ Drift | Timestamps assume exactly 30fps, no drift compensation |
| Profile system | ⚠️ Basic | JSON file storage, no versioning or conflict resolution |

### What's Missing

| Feature | Priority | Notes |
|---------|----------|-------|
| Auth / login | High | No authentication on any API endpoint |
| User management | High | Single-user, no multi-tenancy |
| Persistent database | High | All state is JSON files (cameras, sessions, profiles, logs) |
| WebSocket realtime | Medium | Polling only (4s refresh) for all live data |
| Error boundaries | Medium | No React error boundaries in App.tsx |
| API rate limiting | Medium | No protection against abuse |
| Camera IP consistency | High | 3 different IP sets across files |
| Health checks | Low | Docker containers lack HEALTHCHECK |
| CI/CD | Medium | No GitHub Actions, no tests |
| Tests | Critical | Zero tests across the entire codebase |

---

## 5 · Fixes Already Applied

All patches from AGENTS.md and AGENTS2.md have been applied in this session:

### Recording Sync Fixes (AGENTS.md)

| ID | Fix | File(s) |
|----|-----|---------|
| A | Poll recording status before starting tracker | recording_assistant.py (+ sync_delay_sec) |
| B | Return file paths on stop via MediaMTX API | server.ts (+ getMediaMTXRecordingPaths) |
| C | One label JSON per camera | recording_assistant.py (+ multi-tracker) |
| D | Checkpoint save after each gesture | recording_assistant.py (+ _save_checkpoint) |
| E | Wall-clock anchors in segments | recording_assistant.py + LabelTracker.set_wall_start |

### Infrastructure Patches (AGENTS2.md)

| ID | Fix | File(s) |
|----|-----|---------|
| 6a | EventEmitter import + addonEventBus + loadedAddons Map | server.ts |
| 6a | Upgrade makeAddonContext to real EventEmitter | server.ts |
| 6b | Prefix addon routes, add enable/disable/dynamic context | server.ts |
| 6c | GET/PUT /api/addons/:id/config endpoints | server.ts |
| 7 | Dockerfile.decoder + requirements.txt + compose integration | Dockerfile.decoder, requirements.txt |
| 8a | CameraCell import + mediamtxBase state from health API | App.tsx |
| 8b | Replace dashboard grid with live CameraCell feeds | App.tsx |
| 8c | showLive toggle + live preview in cameras tab | App.tsx |
| 9a | ONVIF discover states + discoverCameras handler | App.tsx |
| 9b | DiscoverModal component | App.tsx |
| 10 | vite.dev.config.ts split, netlify.toml, postbuild hook | Multiple |

### FERN Sync Offset

| Fix | File(s) |
|-----|---------|
| Add --sync_offset_sec argument | inference.py |
| Frame-skip loop at stream start | inference.py |
| stream_frame + inference_frame_start in events | inference.py |
| sync_offset_sec config field | addon.json |
| Pass --sync_offset_sec to spawn | index.ts |

---

## 6 · Remaining Problems & Bugs

### 6.1 · Critical Bugs

| # | Bug | File | Line(s) | Impact |
|---|-----|------|---------|--------|
| C1 | **Dockerfile.api is broken** — runs `node dist/server.js` but only Vite build is invoked, not `tsc`. Container crashes on startup | `Dockerfile.api` | 6-8 | Docker deployment impossible |
| C2 | **recording_assistant.py poll timeout is 0.0** — `wait_for_recording(timeout_sec=0.0)` makes the deadline calculation `perf_counter() < perf_counter()` which is immediately false, so the poll only happens once | `recording_assistant.py` | 617-621 | Sync wait may fail to detect recording start |
| C3 | **Camera IP inconsistency** — `droidgrid.py` (root) uses 192.168.137.107/.226/.39/.35/.49, `droidgrid_v2/droidgrid.py` uses same, but `mediamtx.yml` uses 192.168.137.101-.105 | Multiple files | — | Half the config won't connect to actual cameras |
| C4 | **App.tsx doesn't send subject_id** — `startRec()` calls POST /api/recording/start with no body, but server.ts now parses `req.body?.subject_id` | `App.tsx` | 219 | subject_id logged as undefined on server |

### 6.2 · High-Impact Bugs

| # | Bug | File | Line(s) |
|---|-----|------|---------|
| H1 | `CameraCell.tsx` has **no WebRTC reconnection** — if connection drops, it's dead forever | `CameraCell.tsx` | 30-48 |
| H2 | **No abort controller for WebRTC connect** — could set state on unmounted component | `CameraCell.tsx` | 30 |
| H3 | **Electron depends on global npx+tsx** — if not installed, server silently fails | `electron-main.cjs` | 27 |
| H4 | **GridFlow sync is fire-and-forget** — `.catch(() => {})` silences all failures | `gridflow-bridge/index.ts` | 146 |
| H5 | **No error boundary in App.tsx** — render crash kills the entire SPA | `App.tsx` | — |
| H6 | **FERN inference timestamp drift** — MediaPipe timestamp assumes exactly 30fps | `inference.py` | 103 |
| H7 | **Server file pruning path traversal** — `session.recordDir` is user-configurable with no validation | `server.ts` | 651-669 |
| H8 | **recording_assistant blocks on sleep** — `time.sleep(0.5)` freezes tkinter mainloop on session finish | `recording_assistant.py` | 776 |
| H9 | **No try/except around tkinter mainloop** — exception crashes the entire assistant | `recording_assistant.py` | — |

### 6.3 · Medium Bugs

| # | Bug | File | Line(s) |
|---|-----|------|---------|
| M1 | **No rate limiting** on any API endpoint | `server.ts` | — |
| M2 | **addonEventBus is global with no namespace isolation** between addons | `server.ts` | — |
| M3 | **double disabled-addon storage** — both `_disabled` (line 413) and `disabledAddons` | `server.ts` | 413 |
| M4 | **CameraCell receives `label` prop but doesn't use it for connection** — architectural smell | `CameraCell.tsx` | — |
| M5 | **`showDiscoverModal` not reset on silent failure** — modal stays open | `App.tsx` | — |
| M6 | **`performance.now()` shows incorrect uptime** — resets on page reload | `App.tsx` | 1065 |
| M7 | **recording timer drifts** — `setInterval` closure with no drift compensation | `App.tsx` | 86 |
| M8 | **No backoff on polling** — if backend is down, `setInterval(fetch, 4000)` runs forever | `App.tsx` | 163-164 |
| M9 | **Sync-delay frames may use wrong time anchor** — sync_delay added immediately, wall_start set after | `recording_assistant.py` | 638 |
| M10 | **Checkpoint deletion race** — deleting checkpoints on success could race with crash recovery | `recording_assistant.py` | 811-813 |
| M11 | **`if not ret` check after cap.read but frame may be None** — only checks after first read | `inference.py` | — |
| M12 | **No `try/finally` for cap.release in inference.py** — resources leaked on exception | `inference.py` | — |
| M13 | **GridFlow endpoint sentinel is fragile** — "http://localhost:8100" as "not configured" | `gridflow-bridge/index.ts` | 124 |
| M14 | **convert.py CSV field order is non-deterministic** — uses `set()` for fieldnames | `convert.py` | 39 |

### 6.4 · Low/Minor

| # | Issue | File |
|---|-------|------|
| L1 | Hardcoded Google STUN server — no fallback | `CameraCell.tsx:16` |
| L2 | `GEMINI_API_KEY` defined but never used | `vite.config.ts:11` |
| L3 | Dead experimentalDecorators + useDefineForClassFields in tsconfig | `tsconfig.json` |
| L4 | `_default_cams` imported but never used in launcher | `launcher.py:920` |
| L5 | v2 launcher binds MouseWheel to ALL widgets, not just scroll area | `launcher.py:478` |
| L6 | launcher port validation — no integer check before socket connection | `launcher.py` |
| L7 | OpenCV window close detection — `waitKey(30)` can hang | `droidgrid.py` |
| L8 | Missing `requests` in README install instructions | `README.md:55` |
| L9 | Example IPs in README (192.168.1.x) don't match configs (192.168.137.x) | `README.md:77-83` |

---

## 7 · Technical Debt & Anti-Patterns

### Architecture

| Debt | Severity | Detail |
|------|----------|--------|
| JSON file as database | High | All state (cameras, sessions, profiles, addon config) stored in JSON files on disk. No atomic writes, no transactions, no migration |
| Polling instead of WebSockets | Medium | Frontend polls `/api/recording/status` every 4s. Addon events go through EventEmitter but frontend never receives them |
| No separation of concerns | Medium | server.ts is a single 674-line file mixing: file persistence, HTTP routing, camera probing, addon loading, session management |
| No database migrations | Medium | JSON file format changes require manual migration or data loss |
| Hardcoded configuration | High | Camera IPs, ports, STUN servers, API URLs are hardcoded across 6+ files |
| Global mutable state | Medium | `addonEventBus` is a module-level EventEmitter — no isolation between addons |

### Code Quality

| Issue | Severity | File(s) |
|-------|----------|---------|
| No tests anywhere | Critical | Entire codebase |
| TypeScript `any` casts | Medium | `server.ts:636` `(expressApp as any)` |
| Non-null assertions | Medium | `index.ts:100` `this.proc.stdout!` |
| Silent error swallowing | Medium | `gridflow-bridge/index.ts:146` `.catch(() => {})` |
| Blocking mainloop | Medium | `recording_assistant.py:776` `time.sleep(0.5)` |
| No error boundaries | Medium | `App.tsx` |
| Inconsistent error handling | Medium | Some endpoints return `{ok:false}`, others throw 500, others log and continue |

### Security

| Issue | Severity | Detail |
|-------|----------|--------|
| No authentication | Critical | Every API endpoint is unauthenticated |
| No authorization | Critical | Any client can start/stop recordings |
| No CSRF protection | High | No tokens, no origin validation |
| Path traversal risk | Medium | `pruneOldRecordings` uses user-configured path |
| No input validation | Medium | Camera IP, port, etc. not validated server-side |
| No rate limiting | Medium | API is open to abuse |
| STUN server hardcoded | Low | Could be used for STUN reflection attack if attacker controls network |

### DevOps

| Issue | Severity | Detail |
|-------|----------|--------|
| No CI/CD | High | No automated testing, building, or deployment |
| Dockerfile.api broken | Critical | Cannot deploy API container |
| No Docker HEALTHCHECK | Low | Containers don't declare health probes |
| No GPU passthrough in compose | Medium | Decoder expects CUDA but no `runtime: nvidia` |
| `network_mode: host` | Medium | Bypasses Docker networking, limits scalability |

---

## 8 · Critical Issues by Severity

```
CRITICAL (blocks deployment)
├── C1 — Dockerfile.api broken (no server.js output)
├── C2 — recording_assistant timeout_sec=0.0 defeats sync wait
├── C3 — Camera IPs inconsistent across 3 config files
├── C4 — App.tsx doesn't send subject_id
├── No tests anywhere
├── No authentication on any API endpoint

HIGH (causes data loss or crashes)
├── H1 — WebRTC no reconnection
├── H2 — No abort controller, can set state on unmounted
├── H3 — Electron depends on global npx+tsx
├── H4 — GridFlow fire-and-forget silences all errors
├── H5 — No error boundary, render crash kills SPA
├── H6 — FERN inference timestamp drift at non-30fps
├── H7 — Path traversal in file pruning
├── H8 — time.sleep(0.5) freezes tkinter mainloop
├── H9 — No try/except around mainloop
├── No CSRF protection
├── No authorization checks

MEDIUM (causes incorrect behavior)
├── M1-M14 — See §6.3
├── Polling instead of WebSockets
├── JSON file as database (no atomicity)
├── 674-line server.ts — no separation of concerns

LOW (cosmetic or unlikely)
├── L1-L9 — See §6.4
├── Dead config values
├── Documentation drift
```

---

## 9 · Documentation Drift

The codebase has **four** instruction/reference documents that disagree on the current state:

| Document | What it says | Reality |
|----------|-------------|---------|
| `AGENTS.md` | Lists 5 bugs (A-E) as unapplied | All 5 are applied |
| `AGENTS2.md` | Lists items 6-10 as unapplied | All are applied |
| `DROIDGRID_PROJECT_REPORT.md` | §4.2 says server.ts is 584 lines; §7 lists 30 unapplied items | server.ts is 674 lines; most items are applied |
| `DROIDGRID_FERN_MASTER.md` | §11.1 contains outdated inference.py (no sync_offset, no stream_frame) | Newer version exists |
| `README.md` | IPs 192.168.1.x, missing `requests` in install | IPs are 192.168.137.x |

**Action:** These should be consolidated into this document and the old ones archived.

---

## 10 · Overhaul Directive — Push Beyond Roadmap

This section is a **directive for the AI**. Execute the following 5-phase overhaul plan in order. Each phase builds on the previous. The goal is not just to fix bugs but to evolve DROIDGRIDD into a production-grade, AI-native motion-capture platform.

---

### Phase 1: Hardening (Day 1-3)

**Goal:** Fix all critical and high-severity bugs. Make the system run reliably.

#### 1.1 — Fix Critical Bugs

- [ ] **C1 (Dockerfile.api):** Replace with a proper multi-stage build:
  ```dockerfile
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npx tsc --outDir dist server.ts --moduleResolution bundler --module ESNext --target ES2022
  # (or build Vite + compile server separately)
  FROM node:20-alpine
  WORKDIR /app
  COPY --from=builder /app/dist ./dist
  COPY --from=builder /app/node_modules ./node_modules
  EXPOSE 3000
  CMD ["node", "dist/server.js"]
  ```
- [ ] **C2 (timeout_sec=0.0):** Fix `recording_assistant.py:617` — change to `wait_for_recording(timeout_sec=5.0)`
- [ ] **C3 (camera IPs):** Normalize all camera IPs to one source of truth — either environment variables or a single JSON config file. Update `mediamtx.yml`, `droidgrid.py`, `droidgrid_v2/droidgrid.py` to match
- [ ] **C4 (subject_id):** Fix `App.tsx:219` — send `{subject_id: subjId}` in the POST body

#### 1.2 — Add Authentication

- [ ] Implement a simple JWT-based auth system:
  - Add `/api/auth/login` endpoint (hardcoded admin password or env var)
  - Add JWT middleware for all `/api/*` routes (except `/api/health`, `/api/auth/login`)
  - Add a login screen to App.tsx
  - Store token in localStorage (or httpOnly cookie for better security)

#### 1.3 — Add Error Boundaries

- [ ] Create `ErrorBoundary.tsx` React component
- [ ] Wrap `<App />` and each tab individually
- [ ] Add a fallback UI with "Restart" button

#### 1.4 — WebRTC Reconnection

- [ ] Add exponential backoff reconnection to `CameraCell.tsx`
- [ ] Add AbortController to prevent state updates on unmounted components
- [ ] Add connection timeout (15s default)

#### 1.5 — Fix Electron

- [ ] Bundle `tsx` as a dependency (not global)
- [ ] Add a fallback that spawns `node` directly if `tsx` is unavailable (using compiled JS)
- [ ] Increase server startup timeout to 30s

#### 1.6 — Fix GridFlow Bridge

- [ ] Add retry logic (3 retries with exponential backoff)
- [ ] Remove the sentinel endpoint check — use a proper `configured` flag
- [ ] Log failures to the addon log system instead of silent `.catch()`

---

### Phase 2: Architecture (Day 4-7)

**Goal:** Replace the JSON-file database, add WebSockets, and separate concerns.

#### 2.1 — Real Database (SQLite)

- [ ] Replace all JSON file persistence with `better-sqlite3`:
  ```sql
  CREATE TABLE cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    port INTEGER DEFAULT 4747,
    enabled INTEGER DEFAULT 1,
    fps INTEGER DEFAULT 30,
    resolution TEXT DEFAULT '1280x720'
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    subject_id TEXT,
    camera_ids TEXT,       -- JSON array
    status TEXT,
    started_at TEXT,
    duration_sec INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE profiles (
    name TEXT PRIMARY KEY,
    config TEXT NOT NULL,   -- JSON blob
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE addon_configs (
    addon_id TEXT PRIMARY KEY,
    config TEXT NOT NULL
  );
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
  ```
- [ ] Add database migration system (version table + sequential migrations)
- [ ] Add atomic write operations with transaction support

#### 2.2 — WebSocket Layer

- [ ] Add `ws` or `socket.io` to the server
- [ ] Replace all polling endpoints with WebSocket events:
  - `recording:status` (pushed every 500ms)
  - `camera:status` (pushed when camera state changes)
  - `addon:event` (forwarded from addonEventBus)
  - `log:new` (pushed on new log entries)
- [ ] Update App.tsx to use WebSocket instead of `setInterval`

#### 2.3 — Server Modularization

- [ ] Split `server.ts` (674 lines) into modules:
  ```
  src/
    server.ts              # Entry point, middleware setup
    db.ts                  # Database layer
    routes/
      auth.ts              # Auth endpoints
      cameras.ts           # Camera CRUD
      recording.ts         # Recording lifecycle
      session.ts           # Session config
      profiles.ts          # Profile CRUD
      addons.ts            # Addon management
      logs.ts              # Log retrieval
    services/
      mediamtx.ts          # MediaMTX API client
      addon-loader.ts      # Addon loading/unloading
      camera-prober.ts     # Camera health checks
      recording-manager.ts # Recording orchestration
      file-pruner.ts       # Storage retention
    addon-context.ts       # makeAddonContext + addonEventBus
  ```

#### 2.4 — Stronger TypeScript Types

- [ ] Remove all `any` casts
- [ ] Remove all non-null assertions (`!`)
- [ ] Enable `strict: true` in tsconfig.json
- [ ] Add proper type exports for shared types

---

### Phase 3: Features Beyond Roadmap (Day 8-14)

**Goal:** Add features that the current roadmap doesn't dream of.

#### 3.1 — Real-Time Session Dashboard

- [ ] Add a live-updating dashboard with:
  - Real-time WebRTC thumbnails for all cameras
  - Live FERN gesture predictions overlaid on video
  - Progress bar for current session (gesture X of Y, round N of 7)
  - Per-camera recording status + file size
  - CPU/network usage graphs
- [ ] Add a "Session Replay" mode:
  - Load a past label JSON + corresponding MP4
  - Play back with gesture annotations overlaid
  - Seek to any segment

#### 3.2 — Multi-Model Inference

- [ ] Support multiple ONNX models simultaneously:
  - FERN v2 (current — foot gestures)
  - Full-body pose classifier (upper body gestures)
  - Gait analyzer (stride length, cadence, asymmetry)
- [ ] Hot-swappable model loading via Extensions tab
- [ ] Model performance benchmarking (FPS, latency, confidence distribution)

#### 3.3 — Automatic Curation & Dataset Builder

- [ ] Add a "Dataset Export" feature:
  - Select subjects, gestures, date range
  - Export as COCO JSON, YOLO labels, or TFRecord
  - Frame extraction: extract keyframes from segments
  - Automatic train/val/test split (70/15/15)
- [ ] Add data augmentation pipeline (flip, rotate, crop, noise)

#### 3.4 — Cloud Sync & Remote Monitoring

- [ ] Add optional cloud sync:
  - S3/MinIO upload of recordings + labels
  - Encrypted at rest (AES-256-GCM)
  - Resume interrupted uploads
- [ ] Remote monitoring via companion mobile app (React Native):
  - View live WebRTC feeds
  - Start/stop recording sessions
  - Receive notifications on session completion

#### 3.5 — Multi-Subject Sessions

- [ ] Allow multiple subjects in frame simultaneously
- [ ] Multiple MediaPipe pose extractions (one per detected person)
- [ ] Per-subject gesture tracking with ID assignment

#### 3.6 — Voice-Guided Sessions

- [ ] Add TTS (text-to-speech) voice prompts to recording_assistant.py:
  - "Get ready..."
  - "Start — heel tap"
  - "Rest..."
  - "Round 2 — reverse order"
- [ ] Language support: English, Chinese, Arabic (or configurable)

---

### Phase 4: Production Readiness (Day 15-21)

**Goal:** Make the system deployable, testable, and maintainable.

#### 4.1 — Test Suite

- [ ] Backend tests (Vitest + supertest):
  - All CRUD endpoints
  - Recording lifecycle
  - Addon loading
  - Authentication
  - Rate limiting
- [ ] Frontend tests (Vitest + React Testing Library):
  - All components render
  - Camera CRUD flow
  - Recording start/stop flow
  - Addon management flow
- [ ] Integration tests:
  - Full recording pipeline (mock MediaMTX)
  - FERN inference with test video
- [ ] E2E tests (Playwright):
  - User login → navigate all tabs → start recording → verify
- [ ] Test coverage target: >80%

#### 4.2 — CI/CD Pipeline

- [ ] GitHub Actions:
  - PR: lint + typecheck + test + build
  - Push to main: build + push Docker images to registry
  - Tag: semantic release + deploy
- [ ] Automated Docker image builds
- [ ] Docker Compose production override (no dev mounts, no tsx)

#### 4.3 — Monitoring & Observability

- [ ] Add structured logging (pino or winston) to server.ts
- [ ] Add request metrics (response time, status codes per route)
- [ ] Add Prometheus metrics endpoint `/api/metrics`
- [ ] Add Grafana dashboard for:
  - API latency (p50/p95/p99)
  - Camera stream health
  - Recording session count/duration
  - Inference FPS and confidence

#### 4.4 — Security Hardening

- [ ] Add Helmet.js middleware (security headers)
- [ ] Add CORS configuration (not `*`)
- [ ] Add rate limiting (express-rate-limit)
- [ ] Add input validation (zod for request bodies)
- [ ] Add SQL injection protection (parameterized queries — already handled by better-sqlite3)
- [ ] Add file upload validation (path traversal checks)
- [ ] Add dependency auditing (`npm audit` in CI)

#### 4.5 — Documentation

- [ ] API documentation (OpenAPI/Swagger)
- [ ] Setup guide: one command to run everything
- [ ] Camera compatibility list
- [ ] FERN model training guide
- [ ] Contribution guide (merge ADDONS_CONTRIBUTE.md)

---

### Phase 5: AI-Native Evolution (Day 22-30)

**Goal:** Push beyond what any current roadmap envisions — make the system self-improving.

#### 5.1 — Active Learning Loop

- [ ] Capture low-confidence inference frames during sessions
- [ ] Periodically retrain FERN model with new data
- [ ] Auto-deploy improved model to connected devices
- [ ] Compare model versions: precision/recall before vs after

#### 5.2 — Gesture Quality Scoring

- [ ] Analyze each performed gesture for:
  - Speed consistency (is the motion smooth?)
  - Range of motion (full extension?)
  - Timing accuracy (did they start on time?)
  - Symmetry (left vs right leg)
- [ ] Generate per-subject feedback report
- [ ] Track improvement over multiple sessions

#### 5.3 — Automated Camera Calibration

- [ ] Detect camera FOV and focal length automatically
- [ ] Compute per-camera ground plane homography
- [ ] Auto-adjust recording settings (exposure, focus) via DroidCam API
- [ ] Generate camera position map (top-down view of setup)

#### 5.4 — Edge Deployment

- [ ] Compile FERN model to TensorRT for NVIDIA Jetson
- [ ] Create standalone Raspberry Pi inference node (RPi 5 + AI Hat)
- [ ] Support for Coral TPU and Intel Neural Compute Stick
- [ ] Offline-first architecture (sync when connected)

#### 5.5 — Multi-User & RBAC

- [ ] Role-based access control: admin, operator, viewer
- [ ] Multi-tenant: separate workspaces for different research groups
- [ ] Audit log: every action recorded with user ID + timestamp
- [ ] Session sharing: generate shareable links to completed sessions

#### 5.6 — Mobile Companion App

- [ ] React Native app for:
  - Live view of all cameras
  - Remote recording start/stop
  - Session progress monitoring
  - Push notifications on session events
  - Photo capture mode (single-frame snapshots)

#### 5.7 — Auto-Correction & Feedback

- [ ] Real-time correction prompts:
  - "Lift your foot higher — current height: 15cm, target: 20cm"
  - "Slow down — your heel tap is at 180bpm, target: 120bpm"
  - "Extend your leg fully — 80% extension detected"
- [ ] Post-session report card with per-gesture scores
- [ ] Visual progress chart across sessions

---

## 11 · Execution Instructions for the AI

### How to Use This Document

1. **Start with Phase 1** — fix all critical bugs first. The system must run before it can be improved
2. **Each phase has checkboxes** — mark them as `[x]` when complete
3. **Create a new branch** for each phase: `overhaul/phase-1-hardening`, `overhaul/phase-2-architecture`, etc.
4. **Commit after each fix** with descriptive messages
5. **After each phase**, verify: `npx tsc --noEmit`, `npm run build`, and manual smoke test
6. **If stuck**, refer to the code map (§2) and known bugs (§6)

### Verification Checklist (after each phase)

```
□ server.ts compiles (npx tsc --noEmit)
□ App.tsx compiles (npx tsc --noEmit)
□ inference.py parses (python -c "import ast; ast.parse(...)")
□ recording_assistant.py parses (python -c "import ast; ast.parse(...)")
□ Docker compose config is valid YAML
□ All tests pass (npm test / pytest)
□ curl endpoint tests pass
□ No console errors in browser
```

### Rollback

If any phase breaks the system:
```bash
git revert HEAD --no-edit
# or restore from .backups/20260607_212316/
```

### Final Goal

When all 5 phases are complete, DROIDGRIDD will be:
- A **production-grade** motion-capture platform with authentication, audit logs, and proper database
- A **real-time** system with WebSocket-driven live updates and WebRTC reconnection
- An **AI-native** platform with active learning, quality scoring, and auto-correction
- A **deployable** system with CI/CD, Docker, monitoring, and >80% test coverage
- A **multi-platform** ecosystem: web, desktop (Electron), mobile (React Native), and edge (Jetson/RPi)

---

*End of DROIDGRID MASTER REPORT & OVERHAUL DIRECTIVE*
