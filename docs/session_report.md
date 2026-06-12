# DROIDGRIDD — Full Session Report

**Agent:** OpenCode (deepseek-v4-flash-free)
**Date:** 2025-06-11
**Repo root:** `C:\Users\Lucifer\Desktop\personal\DROIDGRIDD`

---

## Summary

Complete overhaul of DROIDGRIDD's sync architecture, auth layer, test infrastructure, and CI pipeline.

- **38 tests across 6 suites — all green**
- **TypeScript:** `tsc --noEmit` — 0 errors
- **Vitest:** 28/28 passed (4 suites)
- **Pytest:** 10/10 passed (2 suites)
- **CI:** 4-job pipeline defined in `.github/workflows/ci.yml`

---

## Phase 1 — Sync Bug Fixes (AGENTS.md §1–5)

### 1.1 recording_assistant.py — Complete Rewrite

**File:** `recording_assistant.py`

Sync bugs A–E from AGENTS.md resolved:

| Bug | Fix |
|-----|-----|
| **A** Recording start latency | `STATE_SYNC_WAIT` polls `/api/recording/status` until `recording:true`, then applies `sync_delay_sec` foot_hold before pre_start |
| **B** No file path returned on stop | `_finish_session()` queries `/v3/recordings/list` via `getMediaMTXRecordingPaths()` |
| **C** Single-camera label JSON | One `LabelTracker` per camera name in `--cameras` list, each gets its own JSON |
| **D** No crash recovery | `_save_checkpoint()` saves partial JSON to `data/new_recordings/__checkpoints__/` after each gesture |
| **E** No wall-clock anchors | Every segment now has `start_sec`, `end_sec`, `duration_sec` derived from wall-clock anchors |

Key implementation details:
- `LabelTracker.__init__()` takes `fps`, `subject_id`, `camera_id`
- `LabelTracker.set_wall_start(wall_time)` — anchors frame 0 to wall clock
- `LabelTracker.add(gesture, start_wall, end_wall)` — frames derived from `(wall - wall_start) × fps`, not cumulative counter
- `LabelTracker.build_json(video_file, droidgrid_meta, actual_fps)` — uses `self.subject_id` and `self.camera_id` from constructor, annotates each segment
- `LabelTracker.save()` — writes JSON to disk
- `LabelTracker.save_checkpoint()` — partial save with `_wall_start` for restore
- `LabelTracker.load_checkpoint()` — static factory, restores full tracker from checkpoint
- `RecordingAssistant._add_all(gesture, duration_sec)` — proxy that calls `tracker.add()` on every camera simultaneously with computed wall times
- `RecordingAssistant._wall_now()` — converts `perf_counter` → `time.time` anchor

**Verification:**
```powershell
python recording_assistant.py --list_gestures     # prints correct gesture list
python recording_assistant.py --subject p_test --no_droidgrid   # runs full flow
```

---

### 1.2 server.ts — Recording Endpoint Patches

**File:** `DroidGrid Pro/server.ts`

Four handlers replaced/added:

| Endpoint | Change |
|----------|--------|
| `POST /api/recording/start` | Returns `session_id` field, logs `subject_id` |
| `GET /api/recording/status` | Returns `cameras` array listing active cameras |
| `POST /api/recording/stop` | **Async handler** — calls `stopMediaMTXPath()` per camera, waits 600ms, calls `getMediaMTXRecordingPaths()`, returns `files: {name: path}` |
| `GET /api/recording/files` | **New** — returns file paths for all cameras |

Two helper functions added from patch file:
- `getMediaMTXRecordingPaths(cameraNames)` — queries MediaMTX API for recording files
- `stopMediaMTXPath(cameraName)` — stops recording for a single camera

---

### 1.3 inference.py — Sync Offset Support

**File:** `addons/fern-inference/inference.py`

Three targeted edits:

1. **`--sync_offset_sec` argument** added (type float, default 0.0)
2. **Sync offset frame skip** — at start of run, discards `round(sync_offset_sec × fps)` frames from stream
3. **`stream_frame` and `inference_frame_start`** fields added to emitted JSON events

---

### 1.4 addon.json + index.ts — Config

**Files:**
- `addons/fern-inference/addon.json` — added `"sync_offset_sec"` config field (type number, default 4.0)
- `addons/fern-inference/index.ts` — added `"--sync_offset_sec", String(cfg.sync_offset_sec ?? 4.0)` to Python args

---

## Phase 2 — Modularization

### 2.1 auth.ts → Factory Pattern

**File:** `DroidGrid Pro/src-server/auth.ts`

- `createAuthModule({ secret, adminPassword, tokenTtlSec })` returns `{ signToken, verifyToken, authMiddleware, loginHandler }`
- Default module-level instance exported as before for backward compat
- No more global state — tests create isolated modules

**API:**
```typescript
export function createAuthModule(opts: AuthOptions): AuthModule {
  // signToken(payload) → JWT string
  // verifyToken(token) → payload | null
  // authMiddleware(req, res, next) → 401 on bad/missing token, skips public paths
  // loginHandler(req, res) → { token } on correct password
}
```

---

### 2.2 rate-limit.ts → Factory Pattern

**File:** `DroidGrid Pro/src-server/rate-limit.ts`

- `createRateLimiter({ maxTokens, windowMs, now })` — factory with injectable clock
- Default exported instance uses `Date.now()`
- Tests inject `now: () => fakeTime` for deterministic timing

**API:**
```typescript
export function createRateLimiter(opts: RateLimiterOptions): {
  tryConsume(key: string): boolean;
}
```

---

### 2.3 ws-hub.ts — WebSocket Hub

**File:** `DroidGrid Pro/src-server/ws-hub.ts` (new, 93 lines)

WebSocket server with auth grace window:

| Close Code | Reason |
|-----------|--------|
| 4400 | Invalid JSON or non-auth first message |
| 4401 | No auth received within grace window |
| 4403 | Bad token (expired/invalid) |

Features:
- `AUTH_GRACE_MS` injectable via `createWsHub({ authGraceMs, verifyToken })`
- `hello` event emitted on successful auth
- `broadcast(event, data)` — sends to all authenticated clients only
- Injects `fern_event` from addon event bus → broadcast
- Ignores loopback messages (ws-hub-relay)

---

### 2.4 forwarder.ts — Extracted from gridflow-bridge

**File:** `addons/gridflow-bridge/forwarder.ts` (new, 65 lines)

Pure function, no timers, no network — testable with `vi.fn()`:

```typescript
export function createForwarder(
  sendEvents: SendEventsFn,
  options?: ForwarderOptions
): Forwarder
```

Features:
- `enqueue(event)` — extends internal batch buffer
- `flush()` — drains buffer in batches, retries on failure, counts dropped events
- Concurrent flush guard (single drain at a time)
- Backpressure via max queue size (oldest dropped)
- Retries with exponential backoff

---

## Phase 3 — Testing Infrastructure

### 3.1 TypeScript Tests (Vitest)

**Config:** `DroidGrid Pro/vitest.config.ts` — added `resolve.alias` for `@gridflow-bridge/*`, `testTimeout: 10_000`

**Scripts in package.json:** `"test": "vitest run"`, `"test:watch": "vitest"`

**Test files:**

| File | Tests | Coverage |
|------|-------|----------|
| `tests/auth.test.ts` | 10 | Full factory coverage: sign, verify, tamper, expiry, middleware (public/private), login (accept/reject), disabled mode |
| `tests/rate-limit.test.ts` | 5 | allow, block, refill after window, per-IP isolation, x-forwarded-for |
| `tests/gridflow-retry.test.ts` | 6 | enqueue/flush, retries, succeed-after-retry, drop oldest, concurrent guard, stop drain |
| `tests/ws-hub.test.ts` | 7 | hello, 4400 (invalid JSON), 4400 (non-auth), 4403 (bad token), 4401 (grace timeout), broadcast, unauthed excluded |

### 3.2 Python Tests (Pytest)

**Config:** `pytest.ini` — `testpaths = tests_py`, `python_files = test_*.py`

| File | Tests | Coverage |
|------|-------|----------|
| `tests_py/test_label_tracker.py` | 7 | first segment frame 0, wall-clock derivation, contiguous segments, zero-duration, JSON schema, checkpoint roundtrip, multi-camera |
| `tests_py/test_convert.py` | 3 | deterministic headers, sorted headers, JSON roundtrip |

### 3.3 CI Pipeline

**File:** `.github/workflows/ci.yml`

Four parallel jobs:

| Job | Runner | Steps |
|-----|--------|-------|
| `typescript` | ubuntu-latest | Checkout, Node 20, npm ci, tsc, vitest |
| `python` | ubuntu-latest | Checkout, Python 3.12, pip install, pytest |
| `config-drift` | ubuntu-latest | Checkout, `.backups/` comparison, fail if server.ts drifted |
| `docker` | ubuntu-latest | Checkout, Docker build for addon containers |

---

## Phase 4 — Bug Fixes During Testing

### 4.1 TypeScript Fixes

| Issue | Symptom | Fix |
|-------|---------|-----|
| tsconfig missing alias | `tsc --noEmit` failed on `@gridflow-bridge` imports | Added `"@gridflow-bridge/*"` paths entry |
| forwarder droppedEvents | `sendEvents` returning `false` never counted as dropped | Moved `droppedEvents += batch.length` outside `catch`, runs on both throw and false-return on last retry |
| ws-hub test timeout | Default 100ms timeout on 5000ms grace-window test | Raised to 7000ms, restored `expect(code).toBe(4401)` |

### 4.2 Python Fixes

| Issue | Symptom | Fix |
|-------|---------|-----|
| `read_input` list handling | `list.get('cameras')` raised `AttributeError` | Check `isinstance(data, list)` first |
| `save()` signature mismatch | Test passed `subject_id=` which doesn't exist | Removed `subject_id=` from test call |
| Zero-duration segment | `end_frame` could be -1 for zero-duration | Added `max(start_frame, ...)` guard |
| JSON format no file output | `--format json --output out.json` printed to stdout | Changed to write to output file |

---

## Phase 5 — recording_assistant Label JSON Fix

After initial implementation, the label JSON was missing `camera_id` and `subject_id` in segments. Fixed `build_json()` to use `self.subject_id`, `self.camera_id`, and wrap each segment properly.

**Final JSON schema:**
```json
{
  "video_file": "/recordings/phone1/2025-06-10_14-30-00-000.mp4",
  "subject_id": "p12",
  "camera_id": 0,
  "nominal_fps": 30,
  "actual_fps": 30,
  "total_frames": 17340,
  "total_sec": 578.0,
  "recorded_at": "2025-06-10T14:39:38.123456",
  "generator": "recording_assistant_v1.2",
  "sync_note": "Frame numbers anchored to confirmed recording start...",
  "gesture_order": ["heel_tap", "foot_lift", ...],
  "droidgrid": { "ok": true, "duration": 577, "files": {...} },
  "segments": [
    {
      "gesture": "foot_hold",
      "start_frame": 0, "end_frame": 29,
      "start_sec": 0.0, "end_sec": 1.0, "duration_sec": 1.0
    }
  ]
}
```

---

## Complete File Inventory

### Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `DroidGrid Pro/src-server/ws-hub.ts` | 93 | WebSocket hub with auth grace window |
| `addons/gridflow-bridge/forwarder.ts` | 65 | Injective forwarder for event batching |
| `DroidGrid Pro/tests/auth.test.ts` | 170 | 10 auth tests |
| `DroidGrid Pro/tests/rate-limit.test.ts` | 78 | 5 rate-limit tests |
| `DroidGrid Pro/tests/gridflow-retry.test.ts` | 111 | 6 forwarder tests |
| `DroidGrid Pro/tests/ws-hub.test.ts` | 145 | 7 ws-hub tests |
| `tests_py/test_label_tracker.py` | 83 | 7 Python tests |
| `tests_py/test_convert.py` | 79 | 3 Python tests |
| `pytest.ini` | 4 | Pytest config |
| `.github/workflows/ci.yml` | 100+ | CI pipeline |

### Files Modified

| File | Change |
|------|--------|
| `recording_assistant.py` | Complete rewrite (wall-clock, multicamera, sync, checkpoint) |
| `DroidGrid Pro/server.ts` | 4 handlers patched (start/status/stop/files) |
| `addons/fern-inference/inference.py` | 3 targeted edits (sync_offset_sec, skip, stream_frame) |
| `addons/fern-inference/addon.json` | Added sync_offset_sec config field |
| `addons/fern-inference/index.ts` | Added --sync_offset_sec arg |
| `addons/gridflow-bridge/scripts/convert.py` | Fixed read_input, JSON output |
| `DroidGrid Pro/src-server/auth.ts` | Factory refactor |
| `DroidGrid Pro/src-server/rate-limit.ts` | Factory refactor |
| `DroidGrid Pro/tsconfig.json` | Added @gridflow-bridge paths alias |
| `DroidGrid Pro/vitest.config.ts` | Added resolve alias, test timeout |
| `DroidGrid Pro/package.json` | Added test scripts |

---

## What's Blocked / Pending

### Blocked
- **Phase 2A: server.ts modularization** (addon-host skeleton, DB migration, WebSocket integration) — user needs to paste the full `server.ts` source so we can refactor it properly

### Pending
- **mediamtx.yml verification** — confirm `api: yes` and `apiAddress: :9997` are set
- **Full server.ts integration** — wire auth middleware, rate-limiter, and ws-hub into production server (requires the file paste first)

---

## Current Test State

```
 TypeScript:   tsc --noEmit                     0 errors
 Vitest:       auth.test.ts     10/10 passed
               rate-limit.test.ts  5/5 passed
               gridflow-retry.test.ts 6/6 passed
               ws-hub.test.ts    7/7 passed
               ─────────────────────────
               Total:           28/28 passed  (4 suites)

 Python:       test_label_tracker.py  7/7 passed
               test_convert.py        3/3 passed
               ─────────────────────────
               Total:           10/10 passed  (2 suites)
```
