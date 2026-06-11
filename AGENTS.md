```
 ____  _____  ____  _   _     ____  __  __ _   _  ____
|  _ \|  ___|/ ___|| \ | |   / ___||  \/  | \ | |/ ___|
| |_) | |_  | |    |  \| |  | |    | |\/| |  \| |\__ \
|  _ <|  _| | |___ | |\  |  | |___ | |  | | |\  | ___) |
|_| \_\_____|_____||_| \_|   \____|_|  |_|_| \_||____/

FERN Recording Assistant — Sync & Label Fix
Agent: OpenCode
Scope: recording_assistant.py · server.ts · addon inference.py
Rev:   2025-06-10
```

---

```
┌─ PROBLEM SUMMARY ────────────────────────────────────────────────────────┐
│                                                                           │
│  Five concrete sync bugs between recording_assistant.py and the          │
│  video that MediaMTX actually writes.                                    │
│                                                                           │
│  A  Recording start latency — HIGH                                       │
│     HTTP round-trip + MediaMTX buffer flush = 200–800 ms offset.        │
│     Every frame in the label JSON is shifted forward by this amount.    │
│     FIX: poll /api/recording/status until recording:true,               │
│          then wait sync_delay_sec before starting the tracker.          │
│                                                                           │
│  B  No file path returned on stop — HIGH                                 │
│     server.ts stop endpoint returns {ok,duration,newRepeat} only.       │
│     recording_assistant cannot know which .mp4 corresponds to           │
│     which camera's label JSON.                                           │
│     FIX: after stop, query MediaMTX /v3/recordings/list and             │
│          return {files: {camera_name: path}} in the stop response.      │
│                                                                           │
│  C  Single-camera label JSON — MEDIUM                                    │
│     One label JSON generated regardless of how many cameras record.     │
│     FERN needs one JSON per camera (different video_file, camera_id).   │
│     FIX: generate one tracker + one JSON per camera in --cameras list.  │
│                                                                           │
│  D  No crash recovery — MEDIUM                                           │
│     If the session crashes mid-way, all label data is lost.             │
│     FIX: save a checkpoint JSON after every gesture completes.          │
│                                                                           │
│  E  No wall-clock anchors in segments — LOW                              │
│     Segments have frame counts only. If actual fps ≠ nominal fps,      │
│     there is no way to re-anchor without the raw timestamps.            │
│     FIX: add start_sec, end_sec, duration_sec to every segment.         │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 0 · Before you start

```bash
# From the repo root (C:\Users\Lucifer\Desktop\personal\DROIDGRIDD)
# Confirm the backup exists before touching anything
ls .backups/

# Required Python packages for recording_assistant.py
pip install requests --break-system-packages
```

---

## 1 · Replace recording_assistant.py

**Source file provided:** `recording_assistant.py` (in this delivery zip)
**Destination:** `recording_assistant.py` (repo root)

```
Action: OVERWRITE
File:   C:\Users\Lucifer\Desktop\personal\DROIDGRIDD\recording_assistant.py
Source: recording_assistant.py  (from delivery)
```

#### What changed (do NOT manually re-implement — just copy the file):

```
┌─ New in v1.2 vs v1.1 ───────────────────────────────────────────────────┐
│                                                                          │
│  STATE_SYNC_WAIT         New state after SPACE — polls                  │
│                          /api/recording/status until recording:true.    │
│                          Only then does the tracker and timer start.    │
│                                                                          │
│  _poll_recording_start() Runs every 100ms in STATE_SYNC_WAIT.          │
│                          5s timeout; if not confirmed, warns and        │
│                          proceeds anyway (for no_droidgrid mode).       │
│                                                                          │
│  sync_delay_sec          After confirmation, adds 1.0s of foot_hold    │
│                          BEFORE pre_start. Gives MediaMTX time to       │
│                          flush its internal buffer. Configurable via    │
│                          --sync_delay argument.                          │
│                                                                          │
│  _add_all()              Proxy that calls tracker.add() for every      │
│                          camera simultaneously, keeping all trackers    │
│                          identical.                                      │
│                                                                          │
│  Multiple trackers       One LabelTracker per camera name in           │
│                          --cameras list. Same segments, different       │
│                          camera_id and video_file.                      │
│                                                                          │
│  _save_checkpoint()      Called after each gesture completes.          │
│                          Saves partial JSON to                           │
│                          data/new_recordings/__checkpoints__/           │
│                                                                          │
│  _finish_session()       Queries MediaMTX /v3/recordings/list for     │
│                          actual file paths. Saves one JSON per camera.  │
│                          Cleans up checkpoint files on success.         │
│                                                                          │
│  Segment fields          Each segment now has:                          │
│                          start_frame, end_frame (as before)             │
│                          start_sec, end_sec, duration_sec  ← NEW       │
│                                                                          │
│  LabelTracker.set_wall_start()  Anchors frame 0 to the confirmed       │
│                          recording start time (perf_counter).           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Verify after copy:

```powershell
python recording_assistant.py --list_gestures
# Expected output:
# Round 1: ['heel_tap', 'foot_lift', 'sideway_kick', 'forward_step', 'forward_kick', 'cross_front', 'flamingo_bend']
# Round 2: ['flamingo_bend', 'cross_front', 'forward_kick', 'forward_step', 'sideway_kick', 'foot_lift', 'heel_tap']
# Total: 14 gestures × 7 reps

python recording_assistant.py --subject p_test --no_droidgrid
# Should open fullscreen window, SPACE starts, ESC exits
# After completion: check data/new_recordings/ for label JSON files
```

---

## 2 · Patch server.ts — recording endpoints

**Source file provided:** `server_recording_stop_patch.ts` (in this delivery zip)

This file contains three complete handler replacements. Apply them as follows.

### PATCH-SERVER — Step-by-step

Open `DroidGrid Pro/server.ts`.

#### Step 2.1 — Add helper functions

Find this line (near the top of the file, after the constant declarations):

```typescript
addLog("SERVER", "DroidGrid Pro backend started", "success");
```

Insert the two helper functions from `server_recording_stop_patch.ts`
**immediately before** that line:

```typescript
// paste getMediaMTXRecordingPaths() here
// paste stopMediaMTXPath() here
```

The two functions to paste are the exact text of
`getMediaMTXRecordingPaths` and `stopMediaMTXPath` from the patch file.
They depend on `MEDIAMTX_API` and `addLog` which already exist in server.ts.

#### Step 2.2 — Replace recording/start handler

Find the existing handler:

```typescript
app.post("/api/recording/start", (_req, res) => {
```

Replace the **entire handler** (from `app.post(` to the closing `});`)
with the new handler from `server_recording_stop_patch.ts`.

Key additions:
- Returns `session_id` field in the response body
- Logs the `subject_id` from the request body

#### Step 2.3 — Replace recording/status handler

Find:

```typescript
app.get("/api/recording/status", (_req, res) => {
```

Replace the entire handler with the new version from the patch file.

Key addition:
- Returns a `cameras` array listing which cameras are currently recording

#### Step 2.4 — Replace recording/stop handler

Find:

```typescript
app.post("/api/recording/stop", (_req, res) => {
```

Note: the original is synchronous (`(_req, res) =>`).
The replacement is `async` (`async (_req: Request, res: Response) =>`).

Replace the **entire handler** with the async version from the patch file.

Key additions:
- Calls `stopMediaMTXPath()` per camera
- Waits 600ms for MediaMTX to close the file
- Calls `getMediaMTXRecordingPaths()` and returns `files: {name: path}`

#### Step 2.5 — Add recording/files endpoint

After the new `/api/recording/stop` handler, add the new endpoint:

```typescript
app.get("/api/recording/files", async (_req: Request, res: Response) => {
  const cameraNames = cameras.filter((c) => c.enabled).map((c) => c.name);
  const files       = await getMediaMTXRecordingPaths(cameraNames);
  res.json({ files });
});
```

#### Step 2.6 — Verify server.ts compiles

```powershell
cd "DroidGrid Pro"
npx tsx --version       # confirm tsx available
npx tsx server.ts       # should start without error
# Ctrl+C to stop
```

Expected in output:
```
╔══════════════════════════════════════════════╗
║  DroidGrid Pro — Backend Ready               ║
║  http://localhost:3000                       ║
╚══════════════════════════════════════════════╝
```

#### Step 2.7 — Test the stop endpoint returns files

```powershell
# With server running and MediaMTX running:
curl -X POST http://localhost:3000/api/recording/start
# then immediately:
curl -X POST http://localhost:3000/api/recording/stop
# Expected response now includes:
# { "ok": true, "duration": N, "newRepeat": "r02",
#   "files": { "phone1": "/recordings/phone1/2025-…mp4" } }
```

---

## 3 · Patch addons/fern-inference/inference.py

**No full file replacement needed.**
Apply the following three targeted patches to the existing `inference.py`.

### Patch 3.1 — Add sync_offset_sec argument

Find the `parse_args()` function. After the existing arguments, add:

```python
p.add_argument("--sync_offset_sec", type=float, default=0.0,
               help="Seconds to discard from stream start before counting "
                    "inference frames. Should match recording_assistant "
                    "sync_delay_sec + pre_start_sec (default 0).")
```

### Patch 3.2 — Skip frames during sync offset

In the `run()` function, find the main `while True:` capture loop.
Find where the frame is read:

```python
ret, frame = cap.read()
if not ret or frame is None:
    time.sleep(0.033)
    continue
```

Immediately after that block, add a sync-offset skip at the very start
of the loop body (before any other processing):

```python
# ── Sync offset: discard frames from the start of the stream ──────────────
# This aligns the inference frame counter with the label JSON frame counter.
# The recording_assistant inserts sync_delay_sec + pre_start_sec of foot_hold
# at the beginning of every recording. Skip the same number of frames here
# so that inference frame N corresponds to label JSON frame N.
if args.sync_offset_sec > 0 and frame_count == 0:
    _sync_frames_to_skip = round(args.sync_offset_sec * args.fps)
    _sync_skipped = 0
    while _sync_skipped < _sync_frames_to_skip:
        ret2, _ = cap.read()
        if ret2:
            _sync_skipped += 1
        else:
            time.sleep(0.010)
    print(f"[sync] Skipped {_sync_skipped} frames ({args.sync_offset_sec}s)", flush=True)
```

### Patch 3.3 — Add absolute_frame_start to emitted events

Find where the JSON event is built and emitted (the `print(json.dumps(event))` line).
Add two fields to the event dict:

```python
event = {
    "gesture":              CLASSES[smoothed],
    "confidence":           conf,
    "raw_pred":             CLASSES[pred],
    "probs":                probs.tolist(),
    "timestamp":            time.time(),
    "stream_frame":         frame_count,          # ← ADD
    "inference_frame_start": frame_count - args.window_size,  # ← ADD
}
```

`stream_frame` is the index of the last frame in the current window,
relative to the start of inference (after the sync offset was skipped).
This lets you correlate a detected gesture event directly to a
segment in the label JSON.

### Patch 3.4 — Verify inference.py syntax

```powershell
python -c "import ast; ast.parse(open('addons/fern-inference/inference.py').read()); print('OK')"
```

---

## 4 · Patch addon manifest — add sync_offset_sec config

Open `addons/fern-inference/addon.json`.

In the `"config"` object, add after `"confidence"`:

```json
"sync_offset_sec": {
  "type": "number",
  "default": 4.0,
  "description": "Seconds to skip at stream start. Set to sync_delay_sec + pre_start_sec (default 1.0 + 3.0 = 4.0)."
}
```

Open `addons/fern-inference/index.ts`.

In the `startInference()` method, find the `spawn("python", [...])` call.
Add `--sync_offset_sec` to the args array:

```typescript
"--sync_offset_sec", String(cfg.sync_offset_sec ?? 4.0),
```

Place it after the existing `"--smoothing_n"` argument line.

---

## 5 · Update mediamtx.yml — ensure API is on port 9997

Open `mediamtx.yml`. Confirm (or add) these lines at the top level:

```yaml
api: yes
apiAddress: :9997
```

Without `api: yes`, the `getMediaMTXRecordingPaths()` helper in server.ts
will always return empty and file paths will fall back to the timestamp
pattern.

---

## 6 · Usage after all patches

### 6.1 Single camera, no DroidGrid (dry-run)

```powershell
python recording_assistant.py --subject p12 --no_droidgrid
```

Expected:
- Window opens, SPACE starts
- UI shows "STARTING IN..." then counts down 4s (1s sync_delay + 3s pre_start)
- Session runs normally
- After session: `data/new_recordings/p12_phone1_TIMESTAMP.json` created
- JSON has `sync_note` field and `start_sec`/`end_sec` in every segment

### 6.2 Three cameras with DroidGrid

```powershell
# Terminal 1: start MediaMTX
docker run --rm -d --name mediamtx --network host \
  -v ./mediamtx.yml:/mediamtx.yml \
  bluenviron/mediamtx:latest

# Terminal 2: start DroidGrid backend
cd "DroidGrid Pro" && npm run dev

# Terminal 3: run assistant
python recording_assistant.py `
  --subject p12 `
  --cameras phone1,phone2,phone3 `
  --sync_delay 1.0
```

Expected output after session:
```
============================================================
Session complete.
Subject:  p12
Duration: 581s (17340 frames at 30fps nominal)
Label:    data/new_recordings/p12_phone1_20250610_143022.json
Label:    data/new_recordings/p12_phone2_20250610_143022.json
Label:    data/new_recordings/p12_phone3_20250610_143022.json
============================================================
```

Each label JSON has:
- `video_file`: actual path from MediaMTX recordings list
- `camera_id`:  0, 1, 2 respectively
- `segments`:   identical timeline, different `video_file` and `camera_id`

### 6.3 What sync_delay_sec should be set to

```
┌─ sync_delay_sec guidelines ─────────────────────────────────────────────┐
│                                                                          │
│  Good Wi-Fi (5 GHz, <1m from AP)   →  0.5s                             │
│  Typical Wi-Fi (2.4 GHz, same room) →  1.0s  (default)                 │
│  Slower network / many phones       →  1.5s                             │
│  Worst case / uncertain             →  2.0s                             │
│                                                                          │
│  The assistant always adds PRE_START (3s) on top of sync_delay,        │
│  so total pre-roll before first gesture = sync_delay + 3s.             │
│  This pre-roll is labeled as "foot_hold" in the JSON.                  │
│                                                                          │
│  sync_offset_sec in inference.py should equal sync_delay_sec + 3.0     │
│  (sync_delay + pre_start_sec) so the inference frame counter            │
│  aligns with label JSON frame numbers.                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 7 · Label JSON format (after fix)

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
  "sync_note":    "Frame numbers anchored to the moment DroidGrid confirmed...",
  "gesture_order": ["heel_tap", "foot_lift", ...],
  "droidgrid":    { "ok": true, "duration": 577, "files": {...} },
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
    },
    {
      "gesture":      "foot_hold",
      "start_frame":  120,
      "end_frame":    209,
      "start_sec":    4.0,
      "end_sec":      7.0,
      "duration_sec": 3.0
    },
    {
      "gesture":      "heel_tap",
      "start_frame":  210,
      "end_frame":    254,
      "start_sec":    7.0,
      "end_sec":      8.5,
      "duration_sec": 1.5
    }
  ]
}
```

Segment 0: sync_delay_sec foot_hold (1.0s = 30 frames)
Segment 1: pre_start foot_hold (3.0s = 90 frames)
Segment 2: first countdown foot_hold (3.0s = 90 frames)
Segment 3: first heel_tap perform (1.5s = 45 frames)

---

## 8 · Verification checklist

```
┌─ After applying all patches ────────────────────────────────────────────┐
│                                                                          │
│  □ recording_assistant.py --list_gestures  prints correct list         │
│  □ recording_assistant.py --no_droidgrid opens window, runs full flow  │
│  □ label JSON has start_sec/end_sec in every segment                   │
│  □ label JSON has sync_note field                                       │
│  □ server.ts compiles and starts without error (npx tsx server.ts)     │
│  □ POST /api/recording/start returns session_id                        │
│  □ GET  /api/recording/status returns recording:true when active       │
│  □ POST /api/recording/stop returns files:{} object                    │
│  □ inference.py accepts --sync_offset_sec argument                     │
│  □ inference.py emits stream_frame in gesture events                   │
│  □ mediamtx.yml has api:yes and apiAddress::9997                       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 9 · File delivery map

```
┌─ Files in this delivery ─────────────────────────────────────────────────┐
│                                                                           │
│  recording_assistant.py          → repo root (OVERWRITE)                 │
│  server_recording_stop_patch.ts  → read-only reference for patches       │
│  AGENTS.md                       → repo root (this file)                 │
│                                                                           │
│  Patches applied in-place (no new files):                                │
│    addons/fern-inference/inference.py   (3 targeted edits)               │
│    addons/fern-inference/addon.json     (1 config field added)           │
│    addons/fern-inference/index.ts       (1 argument added)               │
│    DroidGrid Pro/server.ts              (4 handler replacements)          │
│    mediamtx.yml                         (api: yes confirmed)             │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 10 · Rollback

```powershell
# All original files are in .backups/20260607_212316/
# To rollback recording_assistant.py:
Copy-Item .backups\20260607_212316\recording_assistant.py . -Force

# To rollback server.ts:
Copy-Item ".backups\20260607_212316\pro_server.ts" "DroidGrid Pro\server.ts" -Force
```

---

```
 main ─ Vision-Orchestration ─ FERN sync fix ─ rev 2025-06-10
```
