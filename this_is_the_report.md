# DROIDGRIDD — Session Final Report

## Scope
25 sync & infrastructure patches across 9 files implementing:
- Recording lifecycle fixes (AGENTS.md)
- Addon system wiring (AGENTS2.md)
- FERN inference sync offset
- Docker decoder stack
- Live video grid + ONVIF discovery

---

## Files Changed

### Patched (7 files)

| File | What |
|------|------|
| `DroidGrid Pro/server.ts` | `getMediaMTXRecordingPaths()` + `stopMediaMTXPath()` helpers; rewritten start/status/stop endpoints returning `session_id`, `cameras`, `files`; added `/api/recording/files`; added `EventEmitter` addon bus with typed `LoadedAddonEntry`; upgraded `makeAddonContext()`; added `GET/PUT /api/addons/:id/config`; fixed `GET /api/addons` shape |
| `addons/fern-inference/inference.py` | Added `--sync_offset_sec` arg; frame-skip loop at stream start; `stream_frame` + `inference_frame_start` fields in event dict |
| `addons/fern-inference/addon.json` | Added `sync_offset_sec` config field (default 4.0) |
| `addons/fern-inference/index.ts` | Passes `--sync_offset_sec` to Python subprocess |
| `DroidGrid Pro/src/App.tsx` | Import `CameraCell`; `mediamtxBase` state from health API; live WebRTC dashboard grid; `showLive` toggle + live preview in cameras tab; ONVIF discover handler + button + `DiscoverModal` component |
| `docker-compose.yml` | Rewrote vnf-decoder to use `Dockerfile.decoder` + `--sync_offset_sec 4.0` |
| `mediamtx.yml` | Confirmed `api: yes` + `apiAddress: :9997` |

### Created (2 files)

| File | What |
|------|------|
| `DroidGrid Pro/Dockerfile.decoder` | Python 3.11-slim with OpenCV, ONNX Runtime, MediaPipe |
| `addons/fern-inference/requirements.txt` | Python dependency list |

### Pre-existing (no changes this session)

| File | What |
|------|------|
| `recording_assistant.py` | Already v1.2 — sync wait, multi-tracker, checkpoints, wall-clock anchors |

---

## Verification

| Check | Result |
|-------|--------|
| `server.ts` — `npx tsc --noEmit` | 0 errors |
| `App.tsx` — `npx tsc --noEmit` | 0 errors |
| `inference.py` — `ast.parse()` | OK |
| `addon.json` — `json.load()` | OK |
| `docker-compose.yml` — `yaml.safe_load()` | OK |

---

## API Surface Added / Changed

| Endpoint | Method | What it returns |
|----------|--------|-----------------|
| `/api/recording/start` | POST | `{ok, session_id, ...}` |
| `/api/recording/status` | GET | `{recording, cameras: string[], ...}` |
| `/api/recording/stop` | POST | `{ok, duration, newRepeat, files: {name: path}}` |
| `/api/recording/files` | GET | `{files: {name: path}}` |
| `/api/addons` | GET | `{addons: [{id, manifest, enabled}]}` |
| `/api/addons/:id/config` | GET | `{config}` |
| `/api/addons/:id/config` | PUT | `{ok, config}` |

---

## Label JSON Format (after fixes)

```json
{
  "video_file":       "/recordings/phone1/2025-06-10_14-30-00-000.mp4",
  "subject_id":       "p12",
  "camera_id":        0,
  "nominal_fps":      30,
  "actual_fps":       30,
  "total_frames":     17340,
  "segments": [
    {
      "gesture":       "heel_tap",
      "start_frame":   210,
      "end_frame":     254,
      "start_sec":     7.0,
      "end_sec":       8.5,
      "duration_sec":  1.5
    }
  ],
  "sync_note":        "Frame numbers anchored to MediaMTX confirmation + sync_delay",
  "generator":        "recording_assistant_v1.2"
}
```
