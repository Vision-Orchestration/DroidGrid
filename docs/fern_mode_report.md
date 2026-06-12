# FERN Insider Mode — Implementation Report

**Date:** 2025-06-11
**Base commit:** `0900a02` recovery: pre-fern-mode snapshot
**Repository:** `C:\Users\Lucifer\Desktop\personal\DROIDGRIDD`

---

## 1. Design Philosophy

DROIDGRIDD stays standalone. A `--profile` flag loads project-specific configs on top of unchanged defaults. The FERN profile is the first such config — `config/profiles/fern.json`. Profile values fill argparse defaults only when the user hasn't explicitly passed the corresponding CLI flag. This means `--profile fern --sync_delay 2.0` works: 2.0 wins, everything else comes from fern.json.

---

## 2. Files Created

### 2.1 `config/profiles/fern.json`

```json
{
  "profile_name":    "fern",
  "profile_version": "1.0",
  "description":     "FERN v2 dataset recording — 8 gestures, 2 rounds, 7 reps, multi-camera",

  "defaults": {
    "cameras":       "phone1,phone2,phone3",
    "sync_delay":    1.0,
    "fps":           30,
    "reps":          7
  },

  "export": {
    "fern_root":              "C:/fern/FERN_V2",
    "fern_venv":              "C:/fern/FERN_V2/venv/Scripts/python.exe",
    "auto_extract_skeletons": true,
    "label_subdir":           "data/labels",
    "skeleton_subdir":        "data/skeletons",
    "video_subdir":           "data/raw"
  },

  "inference": {
    "sync_offset_sec": 4.0,
    "enabled":         false
  },

  "camera_id_map": {
    "phone1": 0,
    "phone2": 1,
    "phone3": 2,
    "phone4": 3,
    "phone5": 4
  }
}
```

The `export` section controls where recordings land in FERN's tree. The `camera_id_map` ensures label JSONs carry the same integer IDs FERN's model was trained with. The `inference.sync_offset_sec` documents the required offset (sync_delay + pre_start = 1.0 + 3.0 = 4.0) for frame-counter alignment.

### 2.2 `scripts/fern_export.py`

A standalone, importable module (imported by `recording_assistant._run_fern_export`) that also works from the CLI.

#### Functions

**`export_to_fern(subject, label_dir, fern_root, fern_venv, video_files, fps_map, extract_skeletons, camera_id_map, verbose)`**
Main export function. Returns `{ok, cameras: [...], summary: {total_cameras, labels_exported, skeletons_extracted, videos_copied}}`.

For each camera:
1. **Find label JSON** — matches `<subject>_<camera>_*.json` in `label_dir` (DROIDGRIDD's `data/new_recordings/`). Falls back to `*<camera>*<subject>*.json`.
2. **Copy label to FERN** — `fern_root/data/labels/<subject>/<camera>.json`. Injects `camera_id` from the profile's `camera_id_map` if missing or wrong.
3. **Extract skeleton** (optional) — Creates a temp hardlink (or copy) of the video in an isolated temp subdirectory so `extract_skeleton.py --video_dir` finds only that one file. Runs FERN's `src/extract_skeleton.py` as a subprocess (because mediapipe may have conflicting deps). Parses stdout for detection rate and frame count. Output CSV lands in `fern_root/data/skeletons/<subject>/`.
4. **Copy raw video** (optional) — Hardlinks (or copies) the original `.mp4` to `fern_root/data/raw/<subject>/`.

**`extract_single_video(video_path, output_csv, fern_src_dir, python_exe)`**
Runs FERN's `extract_skeleton.py` on a single video file by creating a temp directory containing just that one video. Returns `{ok, path, frames, detection_rate}`.

**`find_fern_json(subject, label_dir, camera_name)`**
Globs for the matching label JSON by multiple naming patterns.

#### CLI Usage
```powershell
python scripts/fern_export.py --subject p12 --label-dir data/new_recordings
python scripts/fern_export.py --subject p12 --label-dir data/new_recordings --no-skeleton
```

---

## 3. Files Modified

### 3.1 `recording_assistant.py`

#### New module-level code (before class definitions)

```python
PROFILE_DIR = Path(__file__).resolve().parent / "config" / "profiles"

def load_profile(name: str) -> dict | None:
    """Load a JSON profile from config/profiles/{name}.json."""
    path = PROFILE_DIR / f"{name}.json"
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)

def _arg_was_provided(arg_name: str) -> bool:
    """Check if a CLI flag was explicitly passed by the user."""
    variants = {f"--{arg_name}", f"--{arg_name.replace('_', '-')}"}
    for i, a in enumerate(sys.argv[1:], 1):
        if a in variants:
            return True
        if a.startswith("--") and "=" in a:
            key = a.split("=")[0]
            if key in variants:
                return True
    return False
```

`load_profile` reads a JSON file from `config/profiles/`. `_arg_was_provided` scans `sys.argv` to determine if a flag was explicitly passed, so profile defaults don't override explicit user intent.

#### New CLI arguments (in `main()`)

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `--profile` | str | None | Config profile name (e.g. `fern`) |
| `--fern-export-dir` | str | None | FERN project root for auto-export. Implies `--auto-export` |
| `--auto-export` | bool | False | Automatically export labels + skeletons after session |

#### Profile merge logic (in `main()`, after `args.list_gestures` guard)

```python
if args.profile:
    profile = load_profile(args.profile)
    if profile is None:
        sys.exit(1)
    prof_defaults = profile.get("defaults", {})
    for key, value in prof_defaults.items():
        arg_key = key.replace("-", "_")
        if hasattr(args, arg_key) and not _arg_was_provided(arg_key):
            if arg_key == "cameras" and isinstance(value, list):
                setattr(args, arg_key, ",".join(value))
            else:
                setattr(args, arg_key, value)
    if args.fern_export_dir is None:
        fern_root = profile.get("export", {}).get("fern_root")
        if fern_root:
            args.fern_export_dir = fern_root
```

Priority: explicit CLI > profile defaults > argparse defaults. The `cameras` special case converts from list (JSON-native) to comma-separated string (argparse-native).

#### New method `RecordingAssistant._run_fern_export()`

Called at the end of `_finish_session_step2()`, after label JSONs are saved and printed:

```python
if self.args.fern_export_dir or self.args.auto_export:
    self._run_fern_export(mediamtx_files, fps_map, saved_paths)
```

The method:
1. Imports `scripts.fern_export.export_to_fern` at call time (avoiding mediapipe dependency at import)
2. Builds `video_files` dict from MediaMTX paths
3. Reads `fern_venv` from the profile's `export.fern_venv`
4. Calls `export_to_fern()` and prints per-camera results

This means the FERN export runs as a synchronous step in the GUI event loop. The user sees "SESSION DONE" in the UI while the export processes in the terminal.

---

## 4. Data Flow

```
recording_assistant.py --subject p12 --profile fern
  │
  ├── load_profile("fern")
  │   └── cameras → "phone1,phone2,phone3"
  │   └── sync_delay → 1.0
  │   └── fern_export_dir → "C:/fern/FERN_V2"
  │
  ├── Session runs (unchanged flow)
  │
  └── _finish_session_step2()
      ├── Saves label JSONs to data/new_recordings/
      ├── Prints summary
      └── _run_fern_export()
          └── export_to_fern()
              ├── Labels  → C:/fern/FERN_V2/data/labels/p12/*.json
              ├── Videos  → C:/fern/FERN_V2/data/raw/p12/*.mp4
              └── Skeletons → C:/fern/FERN_V2/data/skeletons/p12/*.csv
```

---

## 5. Test Results

All pre-existing tests untouched and green:

```
tsc --noEmit         0 errors
Vitest 28/28         all pass  (auth 10, rate-limit 5, gridflow-retry 6, ws-hub 7)
Pytest 10/10         all pass  (label_tracker 7, convert 3)
```

Functional verification:

| Test | Result |
|------|--------|
| `--list_gestures` | Prints correct gesture list |
| `--list_gestures --profile fern` | Same, profile arg ignored (short-circuits before merge) |
| `--profile fern --no_droidgrid` | Merges cameras, sync_delay from fern.json |
| `--profile fern --sync_delay 2.5 --cameras phone1` | CLI wins: sync_delay=2.5, cameras=phone1 only |
| Profile merge cameras list → string | `["phone1","phone2","phone3"]` → `"phone1,phone2,phone3"` |
| `_arg_was_provided` detection | Correctly identifies explicit vs default args |

---

## 6. File Inventory (Delta)

| Action | File | Lines |
|--------|------|-------|
| CREATE | `config/profiles/fern.json` | 42 |
| CREATE | `scripts/fern_export.py` | 230 |
| MODIFY | `recording_assistant.py` | +73 (profile loader + args + export hook) |

---

## 7. Guardrails

- **`PROFILE_DIR`** resolves relative to `recording_assistant.py`'s directory, not CWD
- **`_arg_was_provided`** scans `sys.argv` directly so argparse's default mechanism is undisturbed
- **`scripts/fern_export.py`** imported at call time, not module level — mediapipe won't leak into DROIDGRIDD's process
- **No existing code paths changed** — `--profile` defaults to None, `--auto-export` defaults to False
- **Recovery commit `0900a02`** exists before any FERN-mode code was written
