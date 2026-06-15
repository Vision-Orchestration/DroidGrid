# DroidGrid Pro — Agent Instruction File
# Rev: 2026-06-12

---

## 0. Read This First

This file is the single source of truth for any agent working on DroidGrid Pro.
Read every section before touching any file. Sections marked [LOCKED] describe
decisions already applied and verified. Do NOT re-implement them.

---

## 1. Environment

```
Repo root:   C:\Users\Lucifer\Desktop\personal\DROIDGRIDD\
Shell:       PowerShell
Node:        v20+
Python:      system Python (not FERN venv)
OS:          Windows 11
```

Backups of all pre-patch originals are in:
```
.backups\20260607_212316\
```

If anything breaks catastrophically, restore from there.

---

## 2. Repository Layout

```
DROIDGRIDD\
├── recording_assistant.py          # Stub → src/recording/recording_assistant.py
├── mediamtx.yml                    # Stream broker config [PATCHED]
├── docker-compose.yml              # VNF stack [PARTIALLY PATCHED]
├── AGENTS.md                       # Active working instructions
├── CHANGELOG.md
├── LICENSE
├── README.md
├── pytest.ini
├── requirements.txt
├── config\
│   ├── cameras.json                # Single source of truth for camera IPs
│   └── profiles\fern.json          # FERN Insider Mode preset
├── assets\
│   └── banner.svg                  # Repo banner (updated Jun 12)
├── docs\                           # Archived reports (12 files)
├── src\
│   ├── recording\
│   │   └── recording_assistant.py  # Guided recording UI — v1.2 [PATCHED, WORKING]
│   ├── pro\                        # React 19 + Express + Vite + Tailwind v4
│   │   ├── server.ts               # Express backend [PATCHED, WORKING]
│   │   ├── src\App.tsx             # React SPA [PATCHED]
│   │   ├── src\components\CameraCell.tsx  # WebRTC WHEP player [NEEDS FIX — §9]
│   │   ├── src-server\
│   │   │   ├── auth.ts             # JWT auth module [WORKING]
│   │   │   ├── rate-limit.ts       # Token bucket rate limiter [WORKING]
│   │   │   └── ws-hub.ts           # WebSocket hub [WORKING]
│   │   ├── tests\                  # 4 Vitest suites (28 tests)
│   │   ├── Dockerfile.api          # PARTIALLY FIXED — see §9
│   │   ├── Dockerfile.decoder      # [EXISTS]
│   │   ├── Dockerfile.ui           # [EXISTS]
│   │   ├── tsconfig.json, vite.config.ts, vitest.config.ts
│   │   └── package.json
│   ├── cli\                        # Legacy CLI (droidgrid.py)
│   ├── cli_v2\                     # v2 Python CLI with launcher (DO NOT TOUCH)
│   ├── addons\
│   │   ├── fern-inference\
│   │   │   ├── inference.py        # Python ONNX+MediaPipe [PATCHED]
│   │   │   ├── index.ts            # Addon entry [PATCHED]
│   │   │   ├── addon.json          # Manifest [PATCHED]
│   │   │   └── requirements.txt
│   │   └── gridflow-bridge\
│   │       ├── index.ts            # HTTP forwarding addon [WORKING]
│   │       ├── forwarder.ts        # Retry-queue forwarder [WORKING]
│   │       └── scripts\convert.py  # JSON/CSV converter [WORKING]
│   └── scripts\
│       ├── fern_export.py          # Post-recording FERN export pipeline
│       └── gen_mediamtx_paths.py   # Regenerates mediamtx.yml from cameras.json
└── tests\
    └── py\                         # Python tests (10 tests, ALL PASSING)
        ├── test_label_tracker.py
        └── test_convert.py
```

---

## 3. What Is Already Done [LOCKED — Do NOT Re-Implement]

### recording_assistant.py — v1.2 Sync Fixes (A–E)

All five sync bugs are resolved:

| Bug | Fix | Status |
|---|---|---|
| A — Recording start latency | `STATE_SYNC_WAIT` polls `/api/recording/status` until `recording:true`, then waits `sync_delay_sec` | ✅ Applied |
| B — No file path on stop | `_finish_session_step2()` queries MediaMTX `/v3/recordings/list` | ✅ Applied |
| C — Single-camera label JSON | One `LabelTracker` per camera in `--cameras` list | ✅ Applied |
| D — No crash recovery | `_save_checkpoint()` after each gesture | ✅ Applied |
| E — No wall-clock anchors | `start_sec`, `end_sec`, `duration_sec` on every segment | ✅ Applied |

### server.ts — Recording Endpoints

All four recording endpoints are patched and working:

| Endpoint | What it returns | Status |
|---|---|---|
| `POST /api/recording/start` | `{ok, session_id, cameras, mediamtx, session}` | ✅ |
| `GET /api/recording/status` | `{recording, elapsed, session, cameras: [{name,ip}]}` | ✅ |
| `POST /api/recording/stop` | `{ok, duration, newRepeat, files: {name: path}}` | ✅ |
| `GET /api/recording/files` | `{files: {name: path}}` | ✅ |

Helper functions `getMediaMTXRecordingPaths()` and `stopMediaMTXPath()` are defined
in server.ts above the `addLog("SERVER", ...)` line.

### Addon System

- `addonEventBus` — `EventEmitter` with `setMaxListeners(100)`, declared at module level
- `makeAddonContext()` — wires real `emit()` and `on()` to addonEventBus
- `loadedAddons` — typed `Map<string, LoadedAddonEntry>` with `{instance, manifest, enabled}`
- `GET/PUT /api/addons/:id/config` — both endpoints exist and persist to `~/.droidgrid/addons/`
- `GET /api/addons` — returns `[{id, name, version, enabled}]`

### FERN Inference Addon

- `--sync_offset_sec` arg exists in `inference.py` (default 0.0)
- Frame-skip loop applied at stream start using wall time (not frame count)
- `stream_frame` and `inference_frame_start` emitted in every gesture event
- `sync_offset_sec` config field in `addon.json` (default 4.0)
- `--sync_offset_sec` passed to Python subprocess in `index.ts`

### mediamtx.yml

```yaml
api: yes
apiAddress: :9997
```
Both lines are present. Do NOT remove them.

### App.tsx

- `CameraCell` imported from `./components/CameraCell`
- `mediamtxBase` state fetched from `/api/health`
- Live WebRTC grid in dashboard
- `showLive` toggle in cameras tab
- `discoverCameras()` handler wired to ONVIF discover button
- `DiscoverModal` component registered in JSX return
- `DiscoverModal` and `ProfileModal` both in `<AnimatePresence>`

### FERN Insider Mode

- `--profile fern` loads 3-camera preset from `config/profiles/fern.json`
- Cameras: phone1,phone2,phone3; sync_delay: 1.0; fps: 30; reps: 7
- `--auto-export` runs `src/scripts/fern_export.py` at session end
- Export copies labels → runs `extract_skeleton.py` per camera → transfers videos to `C:/fern/FERN_V2/data/{labels,skeletons,raw}/<subject>/`
- Profile merge priority: CLI flags > profile defaults > code defaults

### Tests

```
TypeScript (Vitest):   28/28 passed
Python (Pytest):       10/10 passed
```

CI pipeline is defined in `.github/workflows/ci.yml`.

---

## 4. Camera IP Configuration

**Single source of truth: `config/cameras.json`**

```json
{
  "cameras": [
    { "id": "phone1", "name": "Phone-1", "ip": "192.168.137.107", "port": 4747, "res": [1280, 720], "fps": 30 },
    { "id": "phone2", "name": "Phone-2", "ip": "192.168.137.226", "port": 4747, "res": [1280, 720], "fps": 30 },
    { "id": "phone3", "name": "Phone-3", "ip": "192.168.137.39",  "port": 4747, "res": [1280, 720], "fps": 30 },
    { "id": "phone4", "name": "Phone-4", "ip": "192.168.137.35",  "port": 4747, "res": [1280, 720], "fps": 30 },
    { "id": "phone5", "name": "Phone-5", "ip": "192.168.137.49",  "port": 4747, "res": [1280, 720], "fps": 30 }
  ]
}
```

`mediamtx.yml` camera paths are regenerated from this file by:
```powershell
python scripts\gen_mediamtx_paths.py
```

**Do NOT hardcode IPs anywhere else.** `droidgrid.py` and `droidgrid_v2/droidgrid.py`
both load from this file at startup via `_load_cameras()`. If IPs need to change,
edit `config/cameras.json` only, then re-run `gen_mediamtx_paths.py`.

---

## 5. MediaMTX Integration

MediaMTX REST API base: `http://localhost:9997/v3`
WebRTC base: `http://localhost:8889`

### Start recording a path
```
POST http://localhost:9997/v3/config/paths/{pathName}/record/start
```

### Stop recording a path
```
POST http://localhost:9997/v3/config/paths/{pathName}/record/stop
```

### List recordings (to get actual file paths)
```
GET http://localhost:9997/v3/recordings/list
```
Returns `{items: [{name, segments: [{fpath}]}]}`.
`getMediaMTXRecordingPaths()` in server.ts does this automatically.

### Path naming convention
Camera name `Phone-1` → path `phone-1` (lowercase, spaces/underscores → hyphens).
This conversion is applied consistently in server.ts.

---

## 6. Label JSON Format (Output of recording_assistant.py)

```json
{
  "video_file":   "/recordings/phone1/2025-06-10_14-30-00-000.mp4",
  "subject_id":   "p12",
  "camera_id":    0,
  "nominal_fps":  30,
  "actual_fps":   30,
  "total_frames": 17340,
  "total_sec":    578.0,
  "recorded_at":  "2025-06-10T14:39:38.123456",
  "generator":    "recording_assistant_v1.2",
  "sync_note":    "Frame numbers anchored to ...",
  "gesture_order": ["heel_tap", "foot_lift", "..."],
  "droidgrid":    { "ok": true, "duration": 577, "files": {} },
  "segments": [
    {
      "gesture":      "foot_hold",
      "start_frame":  0,
      "end_frame":    29,
      "start_sec":    0.0,
      "end_sec":      1.0,
      "duration_sec": 1.0
    }
  ]
}
```

One JSON file is produced per camera per session. File is named after the
MediaMTX recording filename stem.

### Segment timeline (for a standard session)

```
Segment 0: foot_hold — sync_delay_sec (1.0s = 30 frames)
Segment 1: foot_hold — pre_start_sec (3.0s = 90 frames)
Segment 2: foot_hold — countdown before first gesture (3.0s = 90 frames)
Segment 3: heel_tap  — first rep (1.5s = 45 frames)
Segment 4: foot_hold — rest (1.0s = 30 frames)
... (repeating for 7 reps × 14 gestures)
```

---

## 7. recording_assistant.py Usage

The main file is at `src/recording/recording_assistant.py`. A backward-compat stub exists at root `recording_assistant.py`.

```powershell
# Standard multi-camera session (from repo root)
python src/recording/recording_assistant.py --subject p12 --cameras phone1,phone2,phone3
# Or via stub:
python recording_assistant.py --subject p12 --cameras phone1,phone2,phone3

# Without DroidGrid (dry-run, no API calls)
python recording_assistant.py --subject p12 --no_droidgrid

# Print gesture order and exit
python recording_assistant.py --list_gestures

# With FERN profile (loads config/profiles/fern.json)
python recording_assistant.py --subject p12 --profile fern
```

**Default output directory:** `data/new_recordings/`
**Checkpoints:** `data/new_recordings/__checkpoints__/`

### Gesture order
```
Round 1: heel_tap, foot_lift, sideway_kick, forward_step, forward_kick, cross_front, flamingo_bend
Round 2: flamingo_bend, cross_front, forward_kick, forward_step, sideway_kick, foot_lift, heel_tap
7 reps per gesture, 3s countdown, 1.5s GO, 1.0s REST, 30s break between rounds
```

### sync_delay_sec guidelines
```
Good Wi-Fi (5 GHz, <1m)      →  0.5s
Typical Wi-Fi (2.4 GHz)      →  1.0s  (default)
Slow network / many phones   →  1.5s
Worst case                   →  2.0s
```

`sync_offset_sec` in `inference.py` must equal `sync_delay_sec + pre_start_sec`
(default: 1.0 + 3.0 = 4.0).

---

## 8. DroidGrid Pro Backend (server.ts)

### Start dev server
```powershell
cd src/pro
npm run dev
# Opens at http://localhost:3000
```

### TypeScript check
```powershell
cd src/pro
npx tsc --noEmit
# Must return 0 errors before any commit
```

### Run tests
```powershell
cd src/pro
npm test
# Expected: 28/28 Vitest tests pass

cd ../..
pytest tests/py/
# Expected: 10/10 pytest tests pass
```

### Key API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Returns `{status, mediamtxBase, cameras, online, recording}` |
| `/api/cameras` | GET/POST | List / add cameras |
| `/api/cameras/:id` | PUT/DELETE | Edit / remove |
| `/api/cameras/:id/test` | POST | Probe single camera |
| `/api/cameras/test-all` | POST | Probe all enabled cameras |
| `/api/cameras/discover` | POST | ONVIF subnet scan |
| `/api/recording/start` | POST | Start — accepts `{subject_id}` in body |
| `/api/recording/stop` | POST | Stop — returns `{files: {name: path}}` |
| `/api/recording/status` | GET | `{recording, elapsed, cameras}` |
| `/api/recording/files` | GET | Late file path retrieval |
| `/api/session` | GET/PUT | Session config |
| `/api/profiles` | GET/POST | Profile list / save |
| `/api/profiles/:id/load` | POST | Restore cameras + session |
| `/api/addons` | GET | `[{id, name, version, enabled}]` |
| `/api/addons/available` | GET | Filesystem scan |
| `/api/addons/:id/load` | POST | Load addon at runtime |
| `/api/addons/:id/unload` | POST | Unload + destroy |
| `/api/addons/:id/reload` | POST | Unload then load |
| `/api/addons/:id/enable` | POST | Enable + load |
| `/api/addons/:id/disable` | POST | Disable + unload |
| `/api/addons/:id/config` | GET/PUT | Per-addon config |
| `/api/auth/login` | POST | `{password}` → `{token}` |
| `/api/logs` | GET | Last 50 log entries |

---

## 9. Known Bugs (Open — Fix Before Docker Deployment)

### CRITICAL: Dockerfile.api is broken
The API container runs `node dist/server.js` but the build step only runs
`vite build` (frontend), not `tsc` (server). The container crashes on startup.

**Status:** The tsc flag conflict (`--allowImportingTsExtensions` + `--noEmit false`)
was fixed Jun 12, but the broader build pipeline still does not compile server.ts
separately for Node. The full fix (below) must be applied.

**Fix:** Replace `src/pro/Dockerfile.api` with:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Compile server separately
RUN npx tsc --outDir dist-server \
    --moduleResolution bundler \
    --module ESNext \
    --target ES2022 \
    --skipLibCheck \
    server.ts

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "server.js"]
```

### HIGH: CameraCell — no WebRTC reconnection on failure
`CameraCell.tsx` closes the RTCPeerConnection on error but never retries.
Already has exponential backoff state (`attempt`, `scheduleRetry`) defined
but `scheduleRetry` is not called from `pc.onconnectionstatechange`.

**Fix:** In the `pc.onconnectionstatechange` handler, ensure `scheduleRetry()` 
is called when state is `'failed'` or `'disconnected'`. (The current code 
in `CameraCell.tsx` already has this logic — verify it is actually wired.)

### MEDIUM: recording_assistant.py — sync_delay applied before anchor set
`sync_delay_sec` is added to the tracker as `_add_all_wall(t0, t0 + sync_delay)`
but `_anchor_wall` and `_anchor_perf` are set at the same `t0`. This is correct.
Verify that no code path calls `_add_all()` before `_anchor_perf` is initialized.

### MEDIUM: No rate limiting before auth middleware
Auth middleware runs before rate limiting in server.ts. An attacker can hit
`/api/auth/login` at full speed before hitting the token bucket.
Move rate limit middleware to apply before auth on the login endpoint.

---

## 10. Docker Stack

### Start all services
```powershell
docker compose up -d
docker compose ps       # verify all healthy
docker compose logs -f vnf-ingest
```

### Service map

| Service | Container | Port | Status |
|---|---|---|---|
| `vnf-ingest` | `bluenviron/mediamtx:latest` | host network | Working |
| `vnf-decoder` | `Dockerfile.decoder` | host network | Working (if model files mounted) |
| `vnf-api` | `Dockerfile.api` | 3000 | **BROKEN — see §9** |
| `vnf-ui` | `Dockerfile.ui` | 80 | Working |

### vnf-decoder requires model files
Mount your FERN models at `/models/`:
```yaml
volumes:
  - C:/fern/FERN_V2/models_sweep:/models:ro
```
The container expects:
- `/models/fern_v2.onnx`
- `/models/pose_landmarker_heavy.task`

---

## 11. Addon: FERN Inference

### Start inference manually (outside DroidGrid)
```powershell
python addons\fern-inference\inference.py `
    --model       C:\fern\FERN_V2\models_sweep\fern_v2.onnx `
    --mediapipe   C:\Users\<user>\.cache\mediapipe\models\pose_landmarker_heavy.task `
    --rtsp_url    rtsp://localhost:8554/phone1 `
    --n_cameras   1 `
    --camera_id   0 `
    --window_size 60 `
    --confidence  0.6 `
    --sync_offset_sec 4.0
```

### Event format emitted to stdout (JSON lines)
```json
{
  "gesture":               "heel_tap",
  "confidence":            0.87,
  "raw_pred":              "heel_tap",
  "probs":                 [0.01, 0.02, ...],
  "timestamp":             1749123456.789,
  "stream_frame":          180,
  "inference_frame_start": 120
}
```

`stream_frame` is the index of the last frame in the window, after the sync
offset has been skipped. Frame 0 = first inference frame (not stream frame 0).

### Via DroidGrid Pro UI
1. Open `http://localhost:3000`
2. Navigate to **Extensions** tab
3. Find `FERN Foot Gesture Recognition`
4. Click **Load**, then **Enable**
5. POST to `/api/addons/fern-inference/start` or use the UI button

---

## 12. Addon: GridFlow Bridge

Forwards gesture events to an external endpoint. Configured via:
```
PUT /api/addons/gridflow-bridge/config
{
  "endpoint": "http://your-gridflow-server:8100",
  "api_key": "...",
  "auto_sync": true,
  "batch_interval": 5
}
```

If `endpoint` is empty string, the addon is silently disabled (no forwarding).
The `forwarder.ts` module handles retry with exponential backoff (3 retries,
500ms base delay). Dropped events are counted in `forwarder.droppedEvents`.

---

## 13. Files the Agent May Edit

```
recording_assistant.py                 (root stub — only if stub logic changes)
droidgrid_agent.md                     (this file — keep in sync with reality)
mediamtx.yml                           (paths section only — use gen_mediamtx_paths.py)
config/cameras.json                    (IP changes here cascade everywhere)
config/profiles/fern.json              (FERN preset profile)
docker-compose.yml
src/pro/server.ts
src/pro/src/App.tsx
src/pro/src/components/CameraCell.tsx
src/pro/src-server/auth.ts
src/pro/src-server/rate-limit.ts
src/pro/src-server/ws-hub.ts
src/pro/Dockerfile.api                 (NEEDS FIX — see §9)
src/pro/Dockerfile.decoder
src/addons/fern-inference/inference.py
src/addons/fern-inference/index.ts
src/addons/fern-inference/addon.json
src/addons/gridflow-bridge/index.ts
src/addons/gridflow-bridge/forwarder.ts
src/scripts/fern_export.py
src/scripts/gen_mediamtx_paths.py
```

## 14. Files the Agent Must NOT Edit

```
.backups/                           (rollback archive — read-only)
src/pro/tests/                      (tests reflect current API — update only if API changes)
tests/py/                           (same)
src/cli_v2/                         (legacy codebase — do not touch)
src/cli/                            (legacy CLI — do not touch)
.docs/                              (archived reports — read-only)
```

---

## 15. Verification Checklist After Any Change

Run in order. Stop on first failure.

```powershell
# 1. TypeScript compile check
cd src/pro && npx tsc --noEmit
# Expected: 0 errors

# 2. Python syntax check (all py files)
python -c "
import ast, pathlib, sys
errors = []
for p in pathlib.Path('.').rglob('*.py'):
    if '.backups' in str(p) or 'node_modules' in str(p): continue
    try: ast.parse(p.read_text())
    except SyntaxError as e: errors.append(f'{p}: {e}')
if errors:
    [print(e) for e in errors]; sys.exit(1)
print('All Python files OK')
"

# 3. TypeScript tests
cd src/pro && npm test
# Expected: 28/28

# 4. Python tests
cd ../.. && pytest tests/py/ -q
# Expected: 10/10

# 5. recording_assistant smoke test
python src/recording/recording_assistant.py --list_gestures
# Expected: prints Round 1, Round 2, Total: 14 gestures × 7 reps

# 6. Server starts (kill after 5s)
cd src/pro && timeout 5 npx tsx server.ts || true
# Expected: prints backend ready banner, no crash
```

---

## 16. CI Pipeline

Defined in `.github/workflows/ci.yml`. Four jobs:

| Job | Checks |
|---|---|
| `typescript` | `tsc --noEmit`, `npm run build`, `npm test` |
| `python` | syntax check all `.py`, `pytest tests/py/test_convert.py`, `pytest tests/py/test_label_tracker.py` |
| `config-drift` | `python3 src/scripts/gen_mediamtx_paths.py --check` (fails if mediamtx.yml is out of sync with cameras.json) |
| `docker` | `docker build -f src/pro/Dockerfile.api src/pro` |

CI runs on every PR and push to `main`. All four jobs must pass before merging.

---

## 17. State After Last Session (2026-06-14)

### What works
- `src/recording/recording_assistant.py` v1.2 — full session flow, multi-camera, sync, checkpoints, FERN profile
- `src/pro/server.ts` — all recording, camera, session, profile, addon endpoints
- `src/pro/src/App.tsx` — all four tabs, live video, ONVIF discovery, profile modal
- `src/addons/fern-inference/` — sync offset, stream_frame events
- `src/addons/gridflow-bridge/` — retry forwarder, HTTP sync
- Tests — 38/38 pass
- CI — 4-job pipeline defined (config-drift and docker bugs recently fixed)
- Project restructured to `src/` layout (67 files moved)
- Root cleaned to 10 essential files; old directories removed
- FERN Insider Mode built (`--profile`, `--auto-export`, `scripts/fern_export.py`)

### What needs work (priority order)
1. **Dockerfile.api broken** — partial tsc flag fix applied, full §9 recipe still needed
2. **CameraCell WebRTC reconnection** — `scheduleRetry()` may not be wired
3. **Rate limiting before auth** — auth middleware runs before rate limit
4. **20+ subjects need recording** — primary bottleneck for FERN accuracy
5. **Camera-ID flag re-run** — after data expansion, re-evaluate +3.70 pp gain
6. **FERN integration as DroidGrid addon** — architecture designed, not wired end-to-end
7. **WebSocket realtime** — frontend still polls every ~4s; server has ws-hub but frontend uses REST
