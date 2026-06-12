# DroidGrid Pro — Complete Project Report

> **Purpose:** This document contains everything needed to understand, fix, and extend the DroidGrid Pro project. Give this to any AI agent to get it up to speed immediately.
>
> **Revision:** 2025-06-10
> **Repository:** `https://github.com/Vision-Orchestration/DroidGrid`

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Directory Structure](#2-directory-structure)
3. [Architecture](#3-architecture)
4. [File Reference](#4-file-reference)
5. [Known Sync Bugs (Problems A–E)](#5-known-sync-bugs)
6. [What Has Been Done](#6-what-has-been-done)
7. [What Still Needs to Be Done](#7-what-still-needs-to-be-done)
8. [Patch Contract — Exact Code for Each Fix](#8-patch-contract)
9. [Rollback Instructions](#9-rollback-instructions)

---

## 1. Project Overview

DroidGrid Pro is a multi-camera recording and gesture-analysis system. It consists of:

- **MediaMTX** — RTSP/WebRTC/HLS stream broker (Docker container)
- **DroidGrid Pro server** — Express.js + React SPA backend/frontend (Node/TypeScript)
- **`recording_assistant.py`** — Fullscreen guided gesture recording UI (Python/tkinter)
- **Addon system** — Plugin architecture under `addons/` directory
- **FERN inference addon** — Python subprocess running MediaPipe + ONNX for foot gesture recognition
- **GridFlow bridge addon** — Data pipeline for external integration
- **Docker stack** — 4 VNF services (ingest, decoder, api, ui)

The core workflow: phones stream MJPEG → MediaMTX converts to RTSP/WebRTC → recording_assistant guides a subject through gestures → label JSONs are generated per camera → FERN inference runs on the streams → gesture events are emitted.

---

## 2. Directory Structure

```
DROIDGRIDD/
├── recording_assistant.py          # Guided gesture recording UI (v1.2, PATCHED)
├── recording_assistant_preview.html # Preview HTML for label JSON format
├── mediamtx.yml                    # MediaMTX config (PATCHED)
├── docker-compose.yml              # 4-service VNF stack
├── .gitignore
├── AGENTS.md                       # Patch instructions — recording sync fixes
├── AGENTS2.md                      # Patch instructions — remaining gaps
├── ADDONS_CONTRIBUTE.md            # Developer guide for addon system
├── DROIDGRID_SESSION_REPORT.md     # Previous session report
├── DROIDGRID_PROJECT_REPORT.md     # ← THIS FILE
├── requirements.txt                # Root-level Python deps
├── server_recording_stop_patch.ts  # Reference patch file for server.ts
│
├── DroidGrid Pro/                  # Express.js + React SPA
│   ├── server.ts                   # Backend (584 lines) — PARTIALLY PATCHED
│   ├── src/
│   │   ├── App.tsx                 # React SPA (916 lines) — NOT PATCHED
│   │   └── components/
│   │       └── CameraCell.tsx       # WebRTC WHEP player component (exists, unused)
│   ├── Dockerfile.api              # Dockerfile for API service
│   ├── Dockerfile.ui               # Dockerfile for UI service
│   ├── Dockerfile.decoder          # → NOT YET CREATED
│   ├── package.json
│   └── tsconfig.json
│
├── addons/
│   ├── fern-inference/             # FERN gesture recognition addon
│   │   ├── inference.py            # Python inference script (127 lines) — NOT PATCHED
│   │   ├── addon.json              # Manifest (24 lines) — NOT PATCHED
│   │   ├── index.ts                # TypeScript entry (147 lines) — NOT PATCHED
│   │   └── requirements.txt        # → NOT YET CREATED
│   └── gridflow-bridge/            # GridFlow data bridge addon
│       ├── addon.json              # Manifest (21 lines)
│       ├── index.ts                # TypeScript entry (178 lines)
│       └── scripts/
│           └── convert.py          # Data conversion script
│
├── droidgrid_v2/                   # Legacy Python launcher (tkinter)
│   ├── launcher.py                 # Has Addons tab (read-only manifest viewer)
│   ├── droidgrid.py                # Main grid logic (981 lines)
│   └── requirements.txt
│
├── models/                         # ML model files (not in repo)
│   ├── fern_v2.onnx
│   └── pose_landmarker_heavy.task
│
├── recordings/                     # MediaMTX recording output (gitignored)
├── snapshots/                      # Snapshots output (gitignored)
├── data/
│   └── new_recordings/             # Label JSON output from recording_assistant
│
└── .backups/                       # Pre-patch file backups
```

---

## 3. Architecture

```
┌──────────────┐     MJPEG HTTP      ┌──────────────────┐
│   Phones     │ ──────────────────→  │   MediaMTX       │
│  (DroidCam)  │                     │  (vnf-ingest)     │
└──────────────┘                     │  :8554 RTSP       │
                                     │  :8889 WebRTC     │
                                     │  :9997 API        │
                                     └────┬─────────────┘
                                          │
                           ┌──────────────┼──────────────────┐
                           │              │                  │
                           ▼              ▼                  ▼
                   ┌──────────────┐ ┌──────────┐  ┌────────────────┐
                   │ vnf-decoder  │ │ Pro API  │  │ recording_     │
                   │ (inference)  │ │ server   │  │ assistant.py   │
                   │ Python/ONNX  │ │ :3000    │  │ (tkinter UI)   │
                   └──────────────┘ └────┬─────┘  └────────────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │  Pro Web UI  │
                                   │  (React SPA) │
                                   └──────────────┘
```

### Data flow for a recording session:

1. User launches `recording_assistant.py --subject p12`
2. Fullscreen tkinter opens, user presses SPACE
3. Assistant calls `POST /api/recording/start` on the Pro server
4. Pro server tells MediaMTX to start recording each camera path
5. Assistant polls `GET /api/recording/status` until `recording:true`
6. Once confirmed, assistant waits `sync_delay_sec` (default 1.0s), then begins the session
7. Session progresses through: pre_start → countdown → PERFORM → REST → BREAK → next gesture
8. After each gesture completes, a checkpoint JSON is saved
9. After all gestures, `POST /api/recording/stop` is called
10. Assistant queries MediaMTX for actual recording file paths
11. One label JSON per camera is saved to `data/new_recordings/`

### Addon lifecycle:

1. `server.ts` startup calls `loadAllAddons()`
2. For each `addons/<name>/addon.json`, the entry file is imported
3. `makeAddonContext(id)` creates a sandboxed API with `getCameras()`, `registerRoute()`, `log()`, `getConfig()`, `setConfig()`, `emit()`, `on()`
4. The addon's `init(ctx)` method is called
5. Addons communicate via events (e.g., `fern:gesture`) and shared context

---

## 4. File Reference

### 4.1 `recording_assistant.py` (901 lines) — FULLY PATCHED ✅

The main guided recording UI. Built with tkinter, fullscreen mode. Walks the subject through 14 gestures × 7 reps in two rounds.

**Key classes:**
- `DroidGridClient` — REST client for Pro server and MediaMTX API
- `LabelTracker` — Tracks frame ranges per segment, saves label JSON, supports checkpoint saves
- `RecordingAssistant` — Main app with state machine (IDLE → SYNC_WAIT → PRESTART → COUNTDOWN → PERFORM → REST → BREAK → DONE)

**Key features already patched:**
- `STATE_SYNC_WAIT` — polls `/api/recording/status` until recording confirmed
- `_poll_recording_start()` — runs every 100ms, 5s timeout
- `sync_delay_sec` — configurable foot_hold after confirmation
- `_add_all()` — proxies `tracker.add()` to all camera trackers simultaneously
- Multiple trackers — one `LabelTracker` per camera in `--cameras` list
- `_save_checkpoint()` — saves partial JSON after each gesture
- `_finish_session()` — queries MediaMTX paths, saves one JSON per camera
- Segment fields: `start_frame`, `end_frame`, `start_sec`, `end_sec`, `duration_sec`
- `sync_note` in label JSON
    
**Usage:**
```bash
python recording_assistant.py --list_gestures
python recording_assistant.py --subject p12 --no_droidgrid
python recording_assistant.py --subject p12 --cameras phone1,phone2 --sync_delay 1.0
```

### 4.2 `DroidGrid Pro/server.ts` (584 lines) — PARTIALLY PATCHED ⚠️

Express.js backend. Provides REST API for cameras, recording, session, profiles, addons, logs.

**Current state:**
- Addon infrastructure exists: `loadedAddons Map`, `makeAddonContext()`, `loadAddon()`, enable/disable endpoints
- `makeAddonContext()` is the **old version** — missing `EventEmitter`, `addonEventBus`, and proper event routing
- `emit()` just calls `addLog()` instead of using a real event bus
- `on()` is a no-op (`(_event, _handler) => {}`)
- Recording endpoints are **NOT patched** — `POST /api/recording/start` doesn't return `session_id`, `GET /api/recording/status` doesn't return `cameras` array, `POST /api/recording/stop` doesn't return `files`
- Missing helper functions: `getMediaMTXRecordingPaths()`, `stopMediaMTXPath()`
- Missing `GET /api/recording/files` endpoint
- Missing server-level `GET/PUT /api/addons/:id/config` endpoints
- `GET /api/addons` returns bare map keys, not full manifest info

### 4.3 `DroidGrid Pro/src/App.tsx` (916 lines) — NOT PATCHED ❌

React SPA frontend. Four views: Dashboard, Cameras, Extensions, Settings.

**Current state:**
- No `CameraCell` import (component exists at `src/components/CameraCell.tsx` but is unused)
- No `mediamtxBase` state or health API integration
- Dashboard shows static camera status dots — no live WebRTC video grid
- Cameras tab has no ONVIF discover button or DiscoverModal
- No `showLive` toggle for live preview in cameras tab
- Extensions tab has full addon management UI (load, unload, enable, disable)

### 4.4 `DroidGrid Pro/src/components/CameraCell.tsx` (77 lines) — EXISTS, UNUSED

WebRTC WHEP player component. Connects to MediaMTX WHEP endpoint, plays video stream.

**Props:** `camName`, `mediamtxBase`, `isRecording`, `status`, `label`

Uses `RTCPeerConnection` with STUN server to receive WebRTC stream via WHEP protocol.

### 4.5 `addons/fern-inference/inference.py` (127 lines) — NOT PATCHED ❌

Python script that:
1. Connects to RTSP stream from MediaMTX
2. Runs MediaPipe PoseLandmarker for skeleton extraction
3. Extracts lower-body landmarks
4. Runs FERN v2 ONNX model inference on sliding window of frames
5. Emits JSON gesture events to stdout

**Needs:**
- `--sync_offset_sec` argument in `parse_args()`
- Frame-skip logic at stream start to align with recording_assistant timeline
- `stream_frame` and `inference_frame_start` fields in event dict

### 4.6 `addons/fern-inference/addon.json` (24 lines) — NOT PATCHED ❌

Manifest declaring config schema. Missing `sync_offset_sec` config field.

### 4.7 `addons/fern-inference/index.ts` (147 lines) — NOT PATCHED ❌

TypeScript entry point for the addon. Spawns `inference.py` as subprocess, parses JSON events from stdout, emits `fern:gesture` events.

Missing `--sync_offset_sec` in spawn args.

### 4.8 `addons/gridflow-bridge/index.ts` (178 lines) — OK ✅

Data bridge addon. Periodically syncs camera state, forwards `fern:gesture` events to external GridFlow endpoint. No patches needed.

### 4.9 `mediamtx.yml` (68 lines) — FULLY PATCHED ✅

Has `api: yes` and `apiAddress: :9997` at lines 17-18. Configures 5 phone paths with recording enabled.

### 4.10 `docker-compose.yml` (97 lines) — PARTIALLY PATCHED ⚠️

4 services: `vnf-ingest` (MediaMTX), `vnf-decoder` (Python), `vnf-api` (Express), `vnf-ui` (Nginx).

Missing `--sync_offset_sec` in vnf-decoder command. Needs `Dockerfile.decoder` and `requirements.txt` files.

### 4.11 `droidgrid_v2/launcher.py` — OK ✅

Python tkinter launcher with Addons tab. Scans `addons/` for manifests, shows details on selection. Read-only (management done via Pro web UI).

---

## 5. Known Sync Bugs

Five concrete sync bugs between `recording_assistant.py` and the video that MediaMTX actually writes. These are the REASON for the patches described in this document.

### A — Recording start latency (HIGH)
**Problem:** HTTP round-trip + MediaMTX buffer flush = 200–800 ms offset. Every frame in the label JSON is shifted forward.
**Fix already applied:** `STATE_SYNC_WAIT` polls `/api/recording/status` until `recording:true`, then waits `sync_delay_sec` before starting the tracker.

### B — No file path returned on stop (HIGH)
**Problem:** `server.ts` stop endpoint returns `{ok, duration, newRepeat}` only. `recording_assistant` cannot know which .mp4 corresponds to which camera's label JSON.
**Fix NOT yet applied:** Need to add `getMediaMTXRecordingPaths()` and `stopMediaMTXPath()` helpers in server.ts, and return `{files: {camera_name: path}}` in the stop response.

### C — Single-camera label JSON (MEDIUM)
**Problem:** One label JSON generated regardless of how many cameras record.
**Fix already applied:** `recording_assistant.py` generates one tracker + one JSON per camera in `--cameras` list.

### D — No crash recovery (MEDIUM)
**Problem:** If session crashes, all label data is lost.
**Fix already applied:** `recording_assistant.py` saves a checkpoint JSON after every gesture completes.

### E — No wall-clock anchors in segments (LOW)
**Problem:** Segments have frame counts only. If actual fps ≠ nominal fps, no way to re-anchor.
**Fix already applied:** `start_sec`, `end_sec`, `duration_sec` added to every segment.

---

## 6. What Has Been Done

These changes are ALREADY APPLIED to the codebase:

### ✅ `recording_assistant.py` — Full v1.2 replacement
- `STATE_SYNC_WAIT` polling state
- `_poll_recording_start()` every 100ms
- `sync_delay_sec` (default 1.0s) between confirmation and session start
- `_add_all()` proxy for multi-camera
- One tracker per camera (`--cameras` list)
- `_save_checkpoint()` after each gesture
- `_finish_session()` queries MediaMTX paths, saves per-camera JSON
- `start_sec`, `end_sec`, `duration_sec` in every segment
- `set_wall_start()` anchors frame 0 to confirmed recording start

### ✅ `mediamtx.yml` — API enabled
- `api: yes` at line 17
- `apiAddress: :9997` at line 18

### ✅ Addon system — Infrastructure
- `server.ts` has `loadedAddons Map`, `loadAddon()`, `loadAllAddons()`, `makeAddonContext()`
- Enable/disable/load/unload/reload endpoints in server.ts
- `App.tsx` Extensions tab with card UI for addon management
- `ADDONS_CONTRIBUTE.md` developer guide

---

## 7. What Still Needs to Be Done

### ❌ Group A: `server.ts` — Recording API fixes (5 items)

1. Add `getMediaMTXRecordingPaths()` helper — queries `MEDIAMTX_API + /recordings/list` and matches camera names to segment file paths
2. Add `stopMediaMTXPath()` helper — calls `POST /config/paths/{name}/record/stop` per camera
3. Rewrite `POST /api/recording/start` to return `session_id` field
4. Rewrite `GET /api/recording/status` to return `cameras` array
5. Rewrite `POST /api/recording/stop` to return `files: {name: path}`
6. Add `GET /api/recording/files` endpoint

### ❌ Group B: `server.ts` — Addon infrastructure upgrades (4 items)

7. Add `import { EventEmitter } from "events"`
8. Declare `addonEventBus = new EventEmitter()` with `setMaxListeners(100)`
9. Add proper typed `loadedAddons: Map<string, {instance, manifest, enabled}>`
10. Upgrade `makeAddonContext()` to use real EventEmitter for `emit()` and `on()`
11. Add `GET /api/addons/:id/config` endpoint
12. Add `PUT /api/addons/:id/config` endpoint
13. Fix `GET /api/addons` to return `{id, name, version, enabled}` from the map

### ❌ Group C: FERN inference sync offset (5 items)

14. `inference.py` — Add `--sync_offset_sec` argument to `parse_args()`
15. `inference.py` — Add frame-skip loop after `cap.read()` when `frame_count == 0` and `sync_offset_sec > 0`
16. `inference.py` — Add `stream_frame` and `inference_frame_start` fields to event dict
17. `addon.json` — Add `sync_offset_sec` config field
18. `index.ts` — Add `--sync_offset_sec` to spawn args

### ❌ Group D: Docker stack (3 items)

19. Create `DroidGrid Pro/Dockerfile.decoder` — Python 3.11-slim with OpenCV, ONNX, MediaPipe
20. Create `addons/fern-inference/requirements.txt` — Python dependency list
21. Update `docker-compose.yml` vnf-decoder command with `--sync_offset_sec 4.0`

### ❌ Group E: `App.tsx` — Live video + ONVIF discovery (6 items)

22. Import `CameraCell` from `./components/CameraCell`
23. Add `mediamtxBase` state, fetch from health API
24. Replace dashboard camera grid with live `CameraCell` WebRTC feeds
25. Add `showLive` toggle state + button in cameras tab
26. Add live preview grid in cameras tab when `showLive` is true
27. Add `discovering`, `discoveredCams`, `showDiscoverModal` states
28. Add `discoverCameras()` handler
29. Add Discover ONVIF button to cameras tab header
30. Add `DiscoverModal` component + register in JSX return

---

## 8. Patch Contract

### 8.1 Server Recording Helper Functions

Insert these TWO functions into `DroidGrid Pro/server.ts` **immediately before** the line:
```typescript
addLog("SERVER", "DroidGrid Pro backend started", "success");
```

```typescript
// ── MediaMTX recording helpers ──────────────────────────────────────────────
async function getMediaMTXRecordingPaths(cameraNames: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const resp = await fetch(`${MEDIAMTX_API}/recordings/list`);
    if (!resp.ok) return result;
    const data = await resp.json() as { items?: Array<{ name: string; segments: Array<{ fpath: string }> }> };
    for (const item of data.items ?? []) {
      const segs = item.segments ?? [];
      if (segs.length === 0) continue;
      const latest = segs[segs.length - 1].fpath;
      for (const camName of cameraNames) {
        if (item.name.toLowerCase().includes(camName.toLowerCase())) {
          result[camName] = latest;
        }
      }
    }
  } catch (e) {
    addLog("MEDIAMTX", `getMediaMTXRecordingPaths error: ${e}`, "warn");
  }
  return result;
}

async function stopMediaMTXPath(pathName: string): Promise<boolean> {
  try {
    const r = await fetch(`${MEDIAMTX_API}/config/paths/${pathName}/record/stop`, { method: "POST" });
    return r.ok;
  } catch {
    return false;
  }
}
```

### 8.2 Rewrite `POST /api/recording/start`

Replace the existing handler with:

```typescript
app.post("/api/recording/start", async (req: Request, res: Response) => {
  if (isRecording) { res.json({ ok: false, msg: "Already recording" }); return; }
  const online = cameras.filter(c => c.enabled && c.status === "online");
  if (!online.length) {
    addLog("REC", "Start failed — no cameras online", "error");
    res.json({ ok: false, msg: "No cameras online" }); return;
  }

  const session_id = `${session.label}_${session.person}_${session.repeat}_${Date.now()}`;
  const mtResults = await Promise.all(online.map(async (cam) => {
    const pathName = cam.name.toLowerCase().replace(/[\s_]+/g, "-");
    try {
      const r = await fetch(`${MEDIAMTX_API}/config/paths/${pathName}/record/start`, { method: "POST" });
      return { cam: cam.name, ok: r.ok, mt: true };
    } catch { return { cam: cam.name, ok: false, mt: true }; }
  }));
  const mtStarted = mtResults.filter(r => r.ok).length;

  isRecording = true;
  recordingStartTime = Date.now();
  online.forEach(c => { c.status = "recording"; });
  writeJson(CAMERAS_FILE, cameras);
  const mode = mtStarted > 0 ? `MediaMTX(${mtStarted})` : "legacy";
  const subject_id = req.body?.subject_id ?? "unknown";
  addLog("REC", `Started: ${session.label}/${session.person}/${session.repeat} (${online.length} cams, ${mode}, subject: ${subject_id})`, "success");
  res.json({ ok: true, session_id, cameras: online.length, mediamtx: mtStarted, session: { ...session } });
});
```

### 8.3 Rewrite `GET /api/recording/status`

Replace with:

```typescript
app.get("/api/recording/status", (_req: Request, res: Response) => {
  const elapsed = isRecording && recordingStartTime ? Math.round((Date.now() - recordingStartTime) / 1000) : 0;
  const recording_cams = cameras.filter(c => c.status === "recording").map(c => ({ name: c.name, ip: c.ip }));
  res.json({ recording: isRecording, elapsed, session, cameras: recording_cams });
});
```

### 8.4 Rewrite `POST /api/recording/stop`

Replace with async version:

```typescript
app.post("/api/recording/stop", async (req: Request, res: Response) => {
  if (!isRecording) { res.json({ ok: false, msg: "Not recording" }); return; }
  const duration = recordingStartTime ? Math.round((Date.now() - recordingStartTime) / 1000) : 0;

  const recording_cams = cameras.filter(c => c.status === "recording");
  await Promise.all(recording_cams.map(async (cam) => {
    const pathName = cam.name.toLowerCase().replace(/[\s_]+/g, "-");
    await stopMediaMTXPath(pathName);
  }));

  // Give MediaMTX time to close the file
  await new Promise(r => setTimeout(r, 600));

  const cameraNames = recording_cams.map(c => c.name);
  const files = await getMediaMTXRecordingPaths(cameraNames);

  isRecording = false;
  recordingStartTime = null;
  cameras.forEach(c => { if (c.status === "recording") c.status = "online"; });
  writeJson(CAMERAS_FILE, cameras);
  try {
    const n = parseInt(session.repeat.replace(/\D/g, ""), 10) + 1;
    session.repeat = `r${String(n).padStart(2, "0")}`;
    writeJson(SESSION_FILE, session);
  } catch {}
  addLog("REC", `Stopped after ${duration}s → ${session.recordDir}/`, "success");
  res.json({ ok: true, duration, newRepeat: session.repeat, files });
});
```

### 8.5 Add `GET /api/recording/files` endpoint

After the stop handler:

```typescript
app.get("/api/recording/files", async (_req: Request, res: Response) => {
  const cameraNames = cameras.filter(c => c.enabled).map(c => c.name);
  const files = await getMediaMTXRecordingPaths(cameraNames);
  res.json({ files });
});
```

### 8.6 Addon EventBus — Import + Declarations

Find the line block:
```typescript
import fs from "fs";
import os from "os";
import http from "http";
```
Add after it:
```typescript
import { EventEmitter } from "events";
```

After the constant declarations block (near the top, after `require`/`import` lines):

```typescript
// ── Addon event bus ────────────────────────────────────────────────────────
const addonEventBus = new EventEmitter();
addonEventBus.setMaxListeners(100);

interface LoadedAddonEntry {
  instance: unknown;
  manifest: Record<string, unknown>;
  enabled: boolean;
}
```

### 8.7 Upgrade `makeAddonContext()`

Replace the existing `makeAddonContext` function (currently lines ~359–388) with:

```typescript
function makeAddonContext(addonId: string, expressApp: express.Application): AddonContext {
  const configFile = path.join(DATA_DIR, "addons", `${addonId}.json`);

  function loadAddonConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(configFile)) {
        return JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
      }
    } catch {}
    return {};
  }

  function saveAddonConfig(data: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(data, null, 2));
  }

  return {
    getCameras: () => cameras,
    registerRoute: (method, routePath, handler) => {
      const fullPath = `/api/addons/${addonId}${routePath}`;
      (expressApp as express.Application)[method.toLowerCase() as "get" | "post" | "put" | "delete"](fullPath, handler);
      addLog("ADDON", `${addonId}: registered ${method} ${fullPath}`, "info");
    },
    log: (msg, level = "info") => { addLog(`ADDON:${addonId}`, msg, level); },
    getConfig: () => loadAddonConfig(),
    setConfig: (patch) => {
      const current = loadAddonConfig();
      saveAddonConfig({ ...current, ...patch });
    },
    emit: (event, data) => { addonEventBus.emit(event, { source: addonId, data }); },
    on: (event, handler) => { addonEventBus.on(event, handler); },
  };
}
```

### 8.8 Update `loadAddon()` to use typed entries

Replace the lines inside `loadAddon()` where the instance is stored:
```typescript
const instance = new AddonClass();
if (typeof instance.init === "function") {
  await instance.init(makeAddonContext(manifest.id, app));
  loadedAddons.set(manifest.id, instance);
  addLog("ADDON", `Loaded: ${manifest.name} v${manifest.version}`, "success");
  return true;
}
```
Replace with:
```typescript
const instance = new AddonClass();
if (typeof instance.init === "function") {
  await instance.init(makeAddonContext(manifest.id, app));
  loadedAddons.set(manifest.id, { instance, manifest, enabled: true });
  addLog("ADDON", `Loaded: ${manifest.name} v${manifest.version}`, "success");
  return true;
}
```

### 8.9 Fix `GET /api/addons` to return proper shape

Replace the current handler:
```typescript
app.get("/api/addons", (_req, res) => {
  const list = Array.from(loadedAddons.keys()).map(id => ({
    id, isRunning: true, enabled: !disabledAddons.has(id),
  }));
  res.json(list);
});
```
With:
```typescript
app.get("/api/addons", (_req: Request, res: Response) => {
  const list = Array.from(loadedAddons.entries()).map(([id, entry]) => ({
    id,
    name: (entry.manifest as Record<string, unknown>).name ?? id,
    version: (entry.manifest as Record<string, unknown>).version ?? "0.0.0",
    enabled: entry.enabled,
  }));
  res.json(list);
});
```

### 8.10 Add `GET/PUT /api/addons/:id/config` endpoints

Insert after the enable/disable endpoints:

```typescript
app.get("/api/addons/:id/config", (req: Request, res: Response) => {
  const entry = loadedAddons.get(req.params.id);
  if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
  const configFile = path.join(DATA_DIR, "addons", `${req.params.id}.json`);
  try {
    const cfg = fs.existsSync(configFile)
      ? JSON.parse(fs.readFileSync(configFile, "utf8"))
      : {};
    res.json(cfg);
  } catch { res.json({}); }
});

app.put("/api/addons/:id/config", (req: Request, res: Response) => {
  const entry = loadedAddons.get(req.params.id);
  if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
  const configFile = path.join(DATA_DIR, "addons", `${req.params.id}.json`);
  let current: Record<string, unknown> = {};
  try {
    if (fs.existsSync(configFile))
      current = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {}
  const updated = { ...current, ...(req.body as Record<string, unknown>) };
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(updated, null, 2));
  addLog("ADDON", `Config updated: ${req.params.id}`, "info");
  res.json(updated);
});
```

### 8.11 `inference.py` — Add `--sync_offset_sec` argument

In the `parse_args()` function, add after the existing arguments:

```python
p.add_argument("--sync_offset_sec", type=float, default=0.0,
               help="Seconds to discard from stream start before counting "
                    "inference frames. Should match recording_assistant "
                    "sync_delay_sec + pre_start_sec (default 0).")
```

### 8.12 `inference.py` — Sync offset frame skip

In the `run()` function, immediately after:
```python
ret, frame = cap.read()
if not ret:
    time.sleep(0.033)
    continue
```
Add:
```python
# ── Sync offset: discard frames from stream start ──
if args.sync_offset_sec > 0 and frame_idx == 0:
    _sync_frames = round(args.sync_offset_sec * 30)  # assumes ~30fps
    _skipped = 0
    while _skipped < _sync_frames:
        r2, _ = cap.read()
        if r2:
            _skipped += 1
        else:
            time.sleep(0.010)
    frame_idx = 0  # reset so frame 0 is first real inference frame
    print(f"[sync] Skipped {_skipped} frames ({args.sync_offset_sec}s)", flush=True)
```

### 8.13 `inference.py` — Add stream_frame to event dict

Change the event dict from:
```python
event = {
    "gesture":    CLASSES[smoothed],
    "confidence": conf,
    "raw_pred":   CLASSES[pred],
    "probs":      probs.tolist(),
    "timestamp":  time.time(),
}
```
To:
```python
event = {
    "gesture":               CLASSES[smoothed],
    "confidence":            conf,
    "raw_pred":              CLASSES[pred],
    "probs":                 probs.tolist(),
    "timestamp":             time.time(),
    "stream_frame":          frame_idx,
    "inference_frame_start": frame_idx - args.window_size,
}
```

### 8.14 `addon.json` — Add sync_offset_sec config

After the `"confidence"` entry, add:
```json
"sync_offset_sec": {
  "type": "number",
  "default": 4.0,
  "description": "Seconds to skip at stream start. Set to sync_delay_sec + pre_start_sec (default 1.0 + 3.0 = 4.0)."
}
```

### 8.15 `index.ts` — Add sync_offset_sec to spawn args

In the `startInference()` method, after the `"--smoothing_n"` arg line, add:
```typescript
"--sync_offset_sec", String(cfg.sync_offset_sec ?? 4.0),
```

### 8.16 `DroidGrid Pro/Dockerfile.decoder` — New file

Create with:
```dockerfile
# ── DroidGrid VNF-Decoder ─────────────────────────────────────────────────
# Python + ONNX Runtime + MediaPipe inference container.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 libgl1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY addons/fern-inference/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY addons/fern-inference/inference.py ./inference.py

CMD ["python", "inference.py", "--help"]
```

### 8.17 `addons/fern-inference/requirements.txt` — New file

Create with:
```text
opencv-python-headless>=4.8.0
numpy>=1.24.0
onnxruntime>=1.17.0
mediapipe>=0.10.14
requests>=2.31.0
```

### 8.18 `docker-compose.yml` — Update vnf-decoder

Update the vnf-decoder service to use Dockerfile.decoder and add `--sync_offset_sec`:
```yaml
  vnf-decoder:
    build:
      context: .
      dockerfile: DroidGrid Pro/Dockerfile.decoder
    container_name: droidgrid-decoder
    network_mode: host
    volumes:
      - ./models:/models:ro
    environment:
      - MEDIAMTX_URL=rtsp://localhost:8554
      - INFERENCE_MODEL=/models/fern_v2.onnx
      - MEDIAPIPE_TASK=/models/pose_landmarker_heavy.task
    command: >
      python inference.py
        --model        /models/fern_v2.onnx
        --mediapipe    /models/pose_landmarker_heavy.task
        --rtsp_url     rtsp://localhost:8554/phone1
        --n_cameras    1
        --camera_id    0
        --window_size  60
        --confidence   0.6
        --sync_offset_sec 4.0
    restart: on-failure
    depends_on:
      vnf-ingest:
        condition: service_healthy
```

### 8.19 App.tsx — Import CameraCell

After the last import line:
```tsx
import { CameraCell } from './components/CameraCell';
```

### 8.20 App.tsx — Add mediamtxBase state

After `const [cameras, setCameras]`:
```tsx
const [mediamtxBase, setMediamtxBase] = useState<string>("http://localhost:8889");
```

### 8.21 App.tsx — Fetch mediamtxBase from health

Update the `refresh` callback: change the destructuring to include health:
```tsx
const [cams, prof, sess, logsData, recStatus, health] = await Promise.all([
  api.get('/api/cameras'),
  api.get('/api/profiles'),
  api.get('/api/session'),
  api.get('/api/logs'),
  api.get('/api/recording/status'),
  api.get('/api/health'),
]);
```
And after `setRecording(recStatus.recording)` add:
```tsx
if (health?.mediamtxBase) setMediamtxBase(health.mediamtxBase);
```

### 8.22 App.tsx — Live video grid in dashboard

Replace the "Camera grid status" BentoCard with the live video grid using CameraCell (see section 8b of AGENTS2.md for the exact JSX).

### 8.23 App.tsx — showLive state + ONVIF discovery states

Add these states near the other `useState` calls:
```tsx
const [showLive, setShowLive] = useState(false);
const [discovering, setDiscovering] = useState(false);
const [discoveredCams, setDiscoveredCams] = useState<Array<{ address: string; name?: string; rtsp_url?: string }>>([]);
const [showDiscoverModal, setShowDiscoverModal] = useState(false);
```

### 8.24 App.tsx — discoverCameras handler

Add inside App() before the return:
```tsx
const discoverCameras = async () => {
  setDiscovering(true);
  try {
    const r = await api.post('/api/cameras/discover');
    if (r.ok && Array.isArray(r.found)) {
      setDiscoveredCams(r.found);
      setShowDiscoverModal(true);
    } else {
      showToast(r.error || 'No ONVIF cameras found', false);
    }
  } catch {
    showToast('Discovery failed — is onvif-zeep installed?', false);
  } finally { setDiscovering(false); }
};
```

### 8.25 App.tsx — Discover ONVIF button

Add a third button in the cameras tab header before "Add Camera". See AGENTS2.md §9a-3 for exact code.

### 8.26 App.tsx — DiscoverModal component

Add the `DiscoverModal` component function inside App() before the `return` statement. See AGENTS2.md §9b for the complete component (it's ~110 lines with the modal overlay, camera list, add buttons).

Register it in the JSX return after the `ProfileModal`:
```tsx
<AnimatePresence>{showDiscoverModal && <DiscoverModal/>}</AnimatePresence>
```

---

## 9. Rollback Instructions

All original pre-patch files are in `.backups/20260607_212316/`:

```powershell
# Rollback recording_assistant.py:
Copy-Item .backups\20260607_212316\recording_assistant.py . -Force

# Rollback server.ts:
Copy-Item ".backups\20260607_212316\pro_server.ts" "DroidGrid Pro\server.ts" -Force

# Rollback App.tsx:
Copy-Item ".backups\20260607_212316\pro_App.tsx" "DroidGrid Pro\src\App.tsx" -Force

# Remove files created by patches:
Remove-Item "DroidGrid Pro\Dockerfile.decoder" -ErrorAction SilentlyContinue
Remove-Item "addons\fern-inference\requirements.txt" -ErrorAction SilentlyContinue
```

---

## Appendix: Label JSON Format (after all fixes)

```json
{
  "video_file":    "/recordings/phone1/2025-06-10_14-30-00-000.mp4",
  "subject_id":    "p12",
  "camera_id":     0,
  "nominal_fps":   30,
  "actual_fps":    30,
  "total_frames":  17340,
  "total_sec":     578.0,
  "recorded_at":   "2025-06-10T14:39:38.123456",
  "generator":     "recording_assistant_v1.2",
  "sync_note":     "Frame numbers anchored to the moment DroidGrid confirmed recording start...",
  "gesture_order": ["heel_tap", "foot_lift", ...],
  "droidgrid":     { "ok": true, "duration": 577, "files": {...} },
  "segments": [
    {
      "gesture":      "foot_hold",
      "start_frame":  0,
      "end_frame":    29,
      "start_sec":    0.0,
      "end_sec":      1.0,
      "duration_sec": 1.0
    },
    {
      "gesture":      "foot_hold",
      "start_frame":  30,
      "end_frame":    119,
      "start_sec":    1.0,
      "end_sec":      4.0,
      "duration_sec": 3.0
    }
  ]
}
```
