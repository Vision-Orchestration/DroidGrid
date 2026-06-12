#!/usr/bin/env python3
"""
recording_assistant.py — FERN v2 Guided Recording Assistant  v1.2.0
=====================================================================
Guides gesture recording sessions with countdown, GO/REST signals,
auto-generated label JSONs per camera, and DroidGrid REST integration.

SYNC CONTRACT
─────────────
The label JSON frame numbers are computed from wall-clock time
relative to the moment DroidGrid confirms recording has started.
A configurable `sync_delay_sec` is inserted between the DroidGrid
start-confirm and the first tracker frame, giving MediaMTX time
to flush its buffer and write the actual first frame.

Label JSON segments use BOTH frame counts AND wall-clock seconds
so downstream tools can re-anchor to actual FPS if it differs
from the nominal rate.

Usage:
    python recording_assistant.py --subject p12 --no_droidgrid
    python recording_assistant.py --subject p12
    python recording_assistant.py --subject p12 --cameras phone1,phone2,phone3
    python recording_assistant.py --list_gestures
"""

import argparse
import json
import math
import sys
import time
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import messagebox

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# ─── PROFILE LOADER ──────────────────────────────────────────────────────────

PROFILE_DIR = Path(__file__).resolve().parent / "config" / "profiles"


def load_profile(name: str) -> dict | None:
    """Load a JSON profile from config/profiles/{name}.json."""
    path = PROFILE_DIR / f"{name}.json"
    if not path.exists():
        print(f"[profile] NOT FOUND: {path}", file=sys.stderr)
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

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

GESTURES_ROUND1 = [
    "heel_tap",
    "foot_lift",
    "sideway_kick",
    "forward_step",
    "forward_kick",
    "cross_front",
    "flamingo_bend",
]

GESTURES_ROUND2 = list(reversed(GESTURES_ROUND1))

TIMING = {
    "fps":                30,
    "countdown_sec":      3.0,
    "gesture_sec":        1.5,
    "rest_sec":           1.0,
    "reps_per_gesture":   7,
    "round_break_sec":    30.0,
    "pre_start_sec":      3.0,    # foot_hold before first gesture
    "sync_delay_sec":     1.0,    # extra foot_hold AFTER recording confirmed, before session
}

GESTURE_CUES = {
    "heel_tap":      "Tap your RIGHT\nHEEL on the ground\nthen return",
    "foot_lift":     "Lift your RIGHT\nKNEE up\nthen lower",
    "sideway_kick":  "Kick RIGHT leg\nout to the SIDE\nthen return",
    "forward_step":  "Step FORWARD with\nyour RIGHT foot\nthen return",
    "forward_kick":  "KICK your right\nleg FORWARD\nthen return",
    "cross_front":   "Cross RIGHT leg\nIN FRONT of left\nthen return",
    "flamingo_bend": "BEND right knee,\nfoot UP behind you\nthen lower",
    "foot_hold":     "Stand STILL\nnaturally",
}

DROIDGRID_URL          = "http://localhost:3000"
DROIDGRID_API_START    = "/api/recording/start"
DROIDGRID_API_STOP     = "/api/recording/stop"
DROIDGRID_API_STATUS   = "/api/recording/status"
DROIDGRID_API_CAMERAS  = "/api/cameras"
MEDIAMTX_API_BASE      = "http://localhost:9997/v3"

COLORS = {
    "bg":        "#0a0a0a",
    "panel":     "#111111",
    "border":    "#222222",
    "countdown": "#d97706",
    "perform":   "#16a34a",
    "rest":      "#1d4ed8",
    "break_col": "#7c3aed",
    "done":      "#374151",
    "text":      "#f9fafb",
    "dim":       "#6b7280",
    "accent":    "#22c55e",
    "white":     "#ffffff",
    "warn":      "#f59e0b",
}

FONTS = {
    "title":   ("Helvetica", 16, "bold"),
    "gesture": ("Helvetica", 42, "bold"),
    "state":   ("Helvetica", 26, "bold"),
    "cue":     ("Helvetica", 18),
    "timer":   ("Helvetica", 120, "bold"),
    "small":   ("Helvetica", 14),
    "rep":     ("Helvetica", 20, "bold"),
}

# ─── GESTURE DRAWINGS ────────────────────────────────────────────────────────

def _legs(c, cx, cy, s, color_l, color_r,
          rx=0, ry=0, rf_dx=0, rf_dy=0, lf_dx=-25):
    c.create_line(cx-40*s, cy-80*s, cx+40*s, cy-80*s, fill=COLORS["white"], width=int(4*s))
    c.create_oval(cx-43*s, cy-83*s, cx-37*s, cy-77*s, fill=color_l, outline="")
    c.create_oval(cx+37*s, cy-83*s, cx+43*s, cy-77*s, fill=color_r, outline="")
    c.create_line(cx-35*s, cy-80*s, cx-35*s, cy-10*s, fill=color_l, width=int(5*s))
    c.create_line(cx-35*s, cy-10*s, cx-35*s+lf_dx*s, cy+60*s, fill=color_l, width=int(5*s))
    c.create_line(cx-35*s+lf_dx*s, cy+60*s, cx-35*s+lf_dx*s-25*s, cy+60*s,
                  fill=color_l, width=int(4*s), capstyle=tk.ROUND)
    c.create_oval(cx-38*s+lf_dx*s, cy+57*s, cx-32*s+lf_dx*s, cy+63*s, fill=color_l, outline="")
    knee_x = cx + 35*s + rx*s
    knee_y = cy - 10*s + ry*s
    c.create_line(cx+35*s, cy-80*s, knee_x, knee_y, fill=color_r, width=int(5*s))
    ankle_x = knee_x + rf_dx*s
    ankle_y = knee_y + 70*s + rf_dy*s
    c.create_line(knee_x, knee_y, ankle_x, ankle_y, fill=color_r, width=int(5*s))
    c.create_line(ankle_x, ankle_y, ankle_x+25*s, ankle_y, fill=color_r, width=int(4*s), capstyle=tk.ROUND)
    c.create_oval(ankle_x-3*s, ankle_y-3*s, ankle_x+3*s, ankle_y+3*s, fill=color_r, outline="")


def draw_neutral(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["dim"])

def draw_heel_tap(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"])
    ankle_x = cx + 35*s; ankle_y = cy + 60*s
    c.create_line(ankle_x, ankle_y, ankle_x+30*s, ankle_y-18*s,
                  fill=COLORS["accent"], width=int(5*s), capstyle=tk.ROUND)
    c.create_oval(ankle_x-4*s, ankle_y-4*s, ankle_x+4*s, ankle_y+4*s,
                  fill="#fbbf24", outline="")

def draw_foot_lift(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"], rx=20, ry=-55, rf_dx=0, rf_dy=-10)

def draw_sideway_kick(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"], rx=60, ry=20, rf_dx=30, rf_dy=-30)
    c.create_line(cx+60*s, cy+30*s, cx+130*s, cy+30*s,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)

def draw_forward_step(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"], rx=10, ry=10, rf_dx=20, rf_dy=-5)
    c.create_line(cx+60*s, cy+45*s, cx+90*s, cy+45*s,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)

def draw_forward_kick(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"], rx=40, ry=-10, rf_dx=45, rf_dy=-35)
    c.create_line(cx+75*s, cy+20*s, cx+120*s, cy+5*s,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)

def draw_cross_front(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"], rx=-50, ry=10, rf_dx=-25)
    c.create_line(cx+35*s, cy, cx-20*s, cy,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)

def draw_flamingo_bend(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"], rx=5, ry=0, rf_dx=20, rf_dy=-80)
    c.create_line(cx+50*s, cy-5*s, cx+60*s, cy-50*s,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)

DRAW_FNS = {
    "foot_hold":     draw_neutral,
    "heel_tap":      draw_heel_tap,
    "foot_lift":     draw_foot_lift,
    "sideway_kick":  draw_sideway_kick,
    "forward_step":  draw_forward_step,
    "forward_kick":  draw_forward_kick,
    "cross_front":   draw_cross_front,
    "flamingo_bend": draw_flamingo_bend,
}

# ─── DROIDGRID CLIENT ────────────────────────────────────────────────────────

class DroidGridClient:
    def __init__(self, base_url: str, enabled: bool = True):
        self.base_url   = base_url.rstrip("/")
        self.enabled    = enabled and HAS_REQUESTS
        self.session_id = None

    def _post(self, path: str, body: dict = None, timeout: float = 5.0) -> dict:
        try:
            r = requests.post(self.base_url + path,
                              json=body or {}, timeout=timeout)
            return r.json() if r.status_code == 200 else {}
        except Exception as e:
            print(f"[DroidGrid] POST {path} error: {e}")
            return {}

    def _get(self, path: str, timeout: float = 3.0) -> dict:
        try:
            r = requests.get(self.base_url + path, timeout=timeout)
            return r.json() if r.status_code == 200 else {}
        except Exception as e:
            print(f"[DroidGrid] GET {path} error: {e}")
            return {}

    def start_recording(self, subject_id: str) -> bool:
        if not self.enabled:
            return True
        data = self._post(DROIDGRID_API_START,
                          {"subject_id": subject_id, "source": "recording_assistant"})
        if data.get("ok"):
            self.session_id = data.get("session_id") or data.get("id")
            print(f"[DroidGrid] Recording started. Session: {self.session_id}")
            return True
        print(f"[DroidGrid] Start failed: {data}")
        return False

    def wait_for_recording(self, timeout_sec: float = 5.0) -> bool:
        """
        Poll /api/recording/status until recording=true or timeout.
        Returns True when confirmed.
        """
        if not self.enabled:
            return True
        deadline = time.perf_counter() + timeout_sec
        while time.perf_counter() < deadline:
            status = self._get(DROIDGRID_API_STATUS)
            if status.get("recording"):
                print("[DroidGrid] Recording confirmed by server.")
                return True
            time.sleep(0.1)
        print("[DroidGrid] WARNING: could not confirm recording start within timeout.")
        return False

    def get_camera_fps(self, camera_names: list) -> dict:
        """
        Query /api/cameras and return {camera_name: fps} for each requested camera.
        Falls back to TIMING['fps'] if camera not found.
        """
        if not self.enabled:
            return {n: TIMING["fps"] for n in camera_names}
        data = self._get(DROIDGRID_API_CAMERAS)
        cams = data if isinstance(data, list) else []
        fps_map = {}
        for name in camera_names:
            matched = next((c for c in cams
                            if c.get("name", "").lower() == name.lower()), None)
            fps_map[name] = matched["fps"] if matched else TIMING["fps"]
        return fps_map

    def stop_recording(self) -> dict:
        if not self.enabled:
            return {}
        data = self._post(DROIDGRID_API_STOP, {"session_id": self.session_id})
        print(f"[DroidGrid] Recording stopped. files: {data.get('files', {})}")
        return data

    def get_mediamtx_recording_paths(self, camera_names: list) -> dict:
        """
        Query MediaMTX recording list and return {camera_name: latest_file_path}.
        Uses the MediaMTX REST API directly (port 9997).
        """
        result = {}
        if not self.enabled:
            return result
        try:
            r = requests.get(f"{MEDIAMTX_API_BASE}/recordings/list", timeout=5)
            if r.status_code != 200:
                return result
            items = r.json().get("items", [])
            for item in items:
                path_name = item.get("name", "")
                segs = item.get("segments", [])
                if segs:
                    # Latest segment
                    latest = segs[-1].get("fpath", "")
                    for cam_name in camera_names:
                        if cam_name.lower() in path_name.lower():
                            result[cam_name] = latest
        except Exception as e:
            print(f"[MediaMTX] Could not get recording paths: {e}")
        return result


# ─── LABEL TRACKER ──────────────────────────────────────────────────────────

class LabelTracker:
    """
    Tracks exact frame ranges for each phase.

    Frame numbers are derived from wall-clock time relative to a known anchor
    point (set_wall_start). This means every segment's start_frame/end_frame
    is computed as round((wall_time - wall_start) * fps), making labels
    deterministic and independent of the order or timing of add() calls.

    Each segment stores both frame numbers (for model training) and
    wall-clock seconds relative to recording start (for re-anchoring
    if actual fps differed from nominal fps).
    """

    def __init__(self, fps: int, subject_id: str, camera_id: int = 0):
        self.fps         = fps
        self.subject_id  = subject_id
        self.camera_id   = camera_id
        self.segments:   list = []
        self._wall_start = 0.0       # absolute time.time() of recording frame 0
        self._checkpoint_cb = None   # called after each gesture completes

    def set_wall_start(self, t: float):
        """Set the absolute time (time.time()) that corresponds to frame 0."""
        self._wall_start = t

    def add(self, gesture: str, start_wall: float, end_wall: float):
        """
        Record a segment from start_wall to end_wall (absolute time.time() values).

        Frame numbers are derived from the wall-clock duration relative to
        _wall_start, which guarantees:

            start_frame = round((start_wall - _wall_start) * fps)
            end_frame   = round((end_wall   - _wall_start) * fps) - 1

        Segments from different trackers with identical wall_start and
        identical add() calls produce bit-identical frame ranges.
        """
        start_sec = start_wall - self._wall_start
        end_sec   = end_wall   - self._wall_start
        start_frame = round(start_sec * self.fps)
        end_frame   = max(start_frame, round(end_sec * self.fps) - 1)

        self.segments.append({
            "gesture":      gesture,
            "start_frame":  start_frame,
            "end_frame":    end_frame,
            "start_sec":    round(start_sec, 4),
            "end_sec":      round(end_sec,   4),
            "duration_sec": round(end_sec - start_sec, 4),
        })

    def notify_gesture_complete(self, gesture: str):
        """Call after all reps of a gesture are done (for checkpoint saves)."""
        if self._checkpoint_cb:
            self._checkpoint_cb(gesture, self)

    @property
    def total_frames(self) -> int:
        if not self.segments:
            return 0
        return self.segments[-1]["end_frame"] + 1

    @property
    def total_sec(self) -> float:
        if not self.segments:
            return 0.0
        return self.segments[-1]["end_sec"]

    def build_json(self, video_file: str = "",
                   droidgrid_meta: dict = None,
                   actual_fps: float | None = None) -> dict:
        seen, unique = set(), []
        for s in self.segments:
            g = s["gesture"]
            if g not in seen:
                seen.add(g); unique.append(g)
        return {
            "video_file":        video_file,
            "subject_id":        self.subject_id,
            "camera_id":         self.camera_id,
            "nominal_fps":       self.fps,
            "actual_fps":        actual_fps or self.fps,
            "total_frames":      self.total_frames,
            "total_sec":         round(self.total_sec, 3),
            "recorded_at":       datetime.now().isoformat(),
            "generator":         "recording_assistant_v1.2",
            "sync_note":         (
                "Frame numbers anchored to the moment DroidGrid confirmed "
                "recording start, plus sync_delay_sec of pre-roll. "
                "Use actual_fps and start_sec/end_sec for re-anchoring."
            ),
            "gesture_order":     unique,
            "droidgrid":         droidgrid_meta or {},
            "segments":          self.segments,
        }

    def save(self, path: str, video_file: str = "",
             droidgrid_meta: dict = None, actual_fps: float | None = None) -> dict:
        data = self.build_json(video_file, droidgrid_meta, actual_fps)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"[Labels] Saved → {path}  "
              f"({len(self.segments)} segments, {self.total_frames} frames, "
              f"{self.total_sec:.1f}s)")
        return data

    def save_checkpoint(self, path: str):
        """Save partial labels — called after each gesture for crash recovery."""
        data = self.build_json(video_file="__CHECKPOINT__")
        data["is_checkpoint"] = True
        data["_wall_start"]   = self._wall_start
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    @staticmethod
    def load_checkpoint(path: str) -> "LabelTracker":
        """Restore a LabelTracker from a checkpoint file (crash recovery)."""
        with open(path) as f:
            data = json.load(f)
        tracker = LabelTracker(
            fps=data["nominal_fps"],
            subject_id=data["subject_id"],
            camera_id=data["camera_id"],
        )
        tracker._wall_start = data.get("_wall_start", 0.0)
        tracker.segments    = data["segments"]
        return tracker


# ─── MAIN APP ────────────────────────────────────────────────────────────────

class RecordingAssistant:

    STATE_IDLE      = "IDLE"
    STATE_SYNC_WAIT = "SYNC_WAIT"   # ← NEW: waiting for DroidGrid to confirm
    STATE_PRESTART  = "PRESTART"
    STATE_COUNTDOWN = "COUNTDOWN"
    STATE_PERFORM   = "PERFORM"
    STATE_REST      = "REST"
    STATE_BREAK     = "BREAK"
    STATE_DONE      = "DONE"

    def __init__(self, args):
        self.args       = args
        self.subject_id = args.subject
        self.fps        = args.fps
        self.state      = self.STATE_IDLE
        self.dg         = DroidGridClient(args.droidgrid_url, not args.no_droidgrid)

        # Camera list from args
        if args.cameras:
            self.camera_names = [c.strip() for c in args.cameras.split(",")]
        else:
            self.camera_names = ["phone1"]   # default single camera

        # One tracker per camera (they share the same timeline)
        self.trackers: dict[str, LabelTracker] = {}
        for i, cam in enumerate(self.camera_names):
            self.trackers[cam] = LabelTracker(self.fps, self.subject_id, camera_id=i)

        # Checkpoint directory
        self.checkpoint_dir = Path(args.output_dir) / "__checkpoints__"

        # Session state
        self.all_gestures    = GESTURES_ROUND1 + GESTURES_ROUND2
        self.gesture_idx     = 0
        self.rep             = 0
        self.phase_end       = 0.0
        self.recording_start = 0.0   # wall-clock when tracker frame 0 corresponds to
        self._anchor_perf    = 0.0   # time.perf_counter() at wall anchor point
        self._anchor_wall    = 0.0   # time.time() at wall anchor point
        self._dg_meta        = {}    # from DroidGrid stop response

        self._build_ui()

    def _wall_now(self) -> float:
        """Convert current perf_counter to wall time anchored to recording start."""
        return self._anchor_wall + (time.perf_counter() - self._anchor_perf)

    # ── tracker proxy ───────────────────────────────────────────────────────

    def _add_all(self, gesture: str, duration_sec: float):
        """Add a segment of duration_sec starting now to every tracker."""
        phase_start_wall = self._wall_now()
        phase_end_wall   = phase_start_wall + duration_sec
        for tracker in self.trackers.values():
            tracker.add(gesture, phase_start_wall, phase_end_wall)

    def _add_all_wall(self, gesture: str, wall_start: float, wall_end: float):
        """Add a segment with explicit wall-clock range to every tracker."""
        for tracker in self.trackers.values():
            tracker.add(gesture, wall_start, wall_end)

    def _save_checkpoint(self, gesture: str):
        """Crash-recovery checkpoint after each gesture completes."""
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        for cam, tracker in self.trackers.items():
            cp_path = self.checkpoint_dir / f"{self.subject_id}_{cam}_ckpt.json"
            tracker.save_checkpoint(str(cp_path))

    # ── UI ──────────────────────────────────────────────────────────────────

    def _build_ui(self):
        self.root = tk.Tk()
        self.root.title("FERN Recording Assistant")
        self.root.configure(bg=COLORS["bg"])
        self.root.attributes("-fullscreen", True)
        self.root.bind("<Escape>", lambda e: self._confirm_quit())
        self.root.bind("<space>",  lambda e: self._on_space())

        W = self.root.winfo_screenwidth()
        H = self.root.winfo_screenheight()
        self.W, self.H = W, H

        # Header
        header = tk.Frame(self.root, bg=COLORS["panel"], height=60)
        header.pack(fill=tk.X, side=tk.TOP)
        header.pack_propagate(False)
        self.lbl_title = tk.Label(header, text="FERN  Recording Assistant",
                                   font=FONTS["title"], bg=COLORS["panel"], fg=COLORS["dim"])
        self.lbl_title.pack(side=tk.LEFT, padx=20, pady=12)
        self.lbl_subject = tk.Label(header,
                                     text=f"Subject: {self.subject_id}   Cameras: {', '.join(self.camera_names)}",
                                     font=FONTS["title"], bg=COLORS["panel"], fg=COLORS["text"])
        self.lbl_subject.pack(side=tk.LEFT, padx=30, pady=12)
        self.lbl_progress = tk.Label(header, text="", font=FONTS["title"],
                                      bg=COLORS["panel"], fg=COLORS["dim"])
        self.lbl_progress.pack(side=tk.RIGHT, padx=20, pady=12)

        # Body
        body = tk.Frame(self.root, bg=COLORS["bg"])
        body.pack(fill=tk.BOTH, expand=True)

        left_w = int(W * 0.38)
        left_frame = tk.Frame(body, bg=COLORS["panel"], width=left_w, bd=0, highlightthickness=0)
        left_frame.pack(side=tk.LEFT, fill=tk.Y, padx=(20, 10), pady=20)
        left_frame.pack_propagate(False)

        self.lbl_gesture_name = tk.Label(left_frame, text="", font=FONTS["gesture"],
                                          bg=COLORS["panel"], fg=COLORS["text"],
                                          wraplength=left_w - 40)
        self.lbl_gesture_name.pack(pady=(30, 10))

        canvas_h = int(H * 0.38)
        self.canvas = tk.Canvas(left_frame, width=left_w - 40, height=canvas_h,
                                 bg=COLORS["panel"], highlightthickness=0)
        self.canvas.pack(pady=10)

        self.lbl_cue = tk.Label(left_frame, text="", font=FONTS["cue"],
                                 bg=COLORS["panel"], fg=COLORS["dim"],
                                 wraplength=left_w - 40, justify=tk.CENTER)
        self.lbl_cue.pack(pady=10)

        right_frame = tk.Frame(body, bg=COLORS["bg"])
        right_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(10, 20), pady=20)

        self.state_banner = tk.Frame(right_frame, bg=COLORS["bg"], bd=0)
        self.state_banner.pack(fill=tk.BOTH, expand=True)

        self.lbl_state = tk.Label(self.state_banner, text="PRESS  SPACE  TO  START",
                                   font=FONTS["state"], bg=COLORS["bg"], fg=COLORS["dim"])
        self.lbl_state.pack(pady=(40, 10))

        self.lbl_timer = tk.Label(self.state_banner, text="",
                                   font=FONTS["timer"], bg=COLORS["bg"], fg=COLORS["text"])
        self.lbl_timer.pack(pady=0)

        self.lbl_rep = tk.Label(self.state_banner, text="",
                                 font=FONTS["rep"], bg=COLORS["bg"], fg=COLORS["dim"])
        self.lbl_rep.pack(pady=10)

        self.progress_bar_bg = tk.Frame(self.state_banner, bg=COLORS["border"], height=8)
        self.progress_bar_bg.pack(fill=tk.X, side=tk.BOTTOM, pady=20)
        self.progress_bar = tk.Frame(self.progress_bar_bg, bg=COLORS["dim"], height=8, width=0)
        self.progress_bar.place(x=0, y=0, relheight=1)

        self.lbl_help = tk.Label(self.root, text="SPACE = start   ESC = quit",
                                  font=FONTS["small"], bg=COLORS["bg"], fg=COLORS["dim"])
        self.lbl_help.pack(side=tk.BOTTOM, pady=8)

        self._draw_gesture("foot_hold")

    def _draw_gesture(self, gesture: str):
        self.canvas.delete("all")
        fn = DRAW_FNS.get(gesture, draw_neutral)
        cw = self.canvas.winfo_width()  or (int(self.W * 0.38) - 40)
        ch = self.canvas.winfo_height() or int(self.H * 0.38)
        fn(self.canvas, cw, ch)
        self.lbl_gesture_name.config(text=gesture.replace("_", "  ").upper())
        self.lbl_cue.config(text=GESTURE_CUES.get(gesture, ""))

    def _set_state_color(self, color_key: str):
        col = COLORS[color_key]
        self.state_banner.config(bg=col)
        self.root.config(bg=col)
        for w in [self.lbl_state, self.lbl_timer, self.lbl_rep]:
            w.config(bg=col)
        self.progress_bar_bg.config(bg=COLORS["border"])

    def _update_progress_bar(self, fraction: float):
        total_w = self.progress_bar_bg.winfo_width() or 800
        w = max(0, min(int(total_w * fraction), total_w))
        self.progress_bar.place(x=0, y=0, relheight=1, width=w)

    def _set_progress_header(self):
        total = len(self.all_gestures)
        rnd   = "Round 1" if self.gesture_idx < len(GESTURES_ROUND1) else "Round 2"
        self.lbl_progress.config(
            text=f"{rnd}   {self.gesture_idx}/{total} gestures")

    # ── Session flow ─────────────────────────────────────────────────────────

    def _on_space(self):
        if self.state == self.STATE_IDLE:
            self._start_session()

    def _start_session(self):
        """
        Start DroidGrid recording, then enter SYNC_WAIT state.

        The SYNC_WAIT state polls the DroidGrid API every 100ms until
        recording is confirmed (or timeout). Only then does the session
        and the tracker begin. This ensures frame 0 of the label JSON
        corresponds to the actual first frame written by MediaMTX.
        """
        if not self.args.no_droidgrid:
            ok = self.dg.start_recording(self.subject_id)
            if not ok:
                if not messagebox.askyesno(
                    "DroidGrid",
                    "Could not connect to DroidGrid.\nContinue without recording?"
                ):
                    return

        # Enter sync-wait state: show spinner, poll for confirmation
        self.state = self.STATE_SYNC_WAIT
        self._set_state_color("done")
        self.lbl_state.config(text="WAITING FOR CAMERA...")
        self.lbl_timer.config(text="●")
        self.lbl_rep.config(text="confirming recording start")
        self._sync_wait_start = time.perf_counter()
        self._sync_poll_count = 0
        self.root.after(100, self._poll_recording_start)

    def _poll_recording_start(self):
        """Poll every 100ms until DroidGrid confirms recording=true."""
        self._sync_poll_count += 1
        elapsed = time.perf_counter() - self._sync_wait_start

        # Animate spinner
        dots = "●" * (self._sync_poll_count % 4 + 1)
        self.lbl_timer.config(text=dots)

        if not self.args.no_droidgrid:
            confirmed = self.dg.wait_for_recording(timeout_sec=5.0)
        else:
            confirmed = True   # no DroidGrid — proceed immediately

        timeout_sec = 5.0
        if confirmed or elapsed > timeout_sec:
            if not confirmed:
                print("[WARNING] DroidGrid recording not confirmed. Proceeding anyway.")

            # NOW add sync_delay: extra pre-roll before session starts.
            # This gives MediaMTX time to flush its buffer.
            sync_delay = TIMING["sync_delay_sec"]
            self._recording_confirmed_at = time.perf_counter()

            # M9: Anchor all trackers at the moment sync_delay begins.
            # Both perf_counter and time.time() are captured so _wall_now()
            # can convert future perf_counter readings back to wall time.
            anchor_wall = time.time()
            self._anchor_wall = anchor_wall
            self._anchor_perf = time.perf_counter()
            for tracker in self.trackers.values():
                tracker.set_wall_start(anchor_wall)

            # Add sync_delay + pre_start as contiguous foot_hold segments.
            # Using explicit wall times ensures no overlap or gap.
            t0 = anchor_wall
            self._add_all_wall("foot_hold", t0, t0 + sync_delay)
            self._add_all_wall("foot_hold", t0 + sync_delay, t0 + sync_delay + TIMING["pre_start_sec"])

            # Wall-clock anchor for the session timer
            self.recording_start  = self._recording_confirmed_at
            self.gesture_idx      = 0
            self.rep              = 0

            self.lbl_state.config(text="STARTING IN...")
            self.lbl_timer.config(text="")
            self.lbl_rep.config(text="")
            self.state    = self.STATE_PRESTART
            total_preroll = sync_delay + TIMING["pre_start_sec"]
            self.phase_end = time.perf_counter() + total_preroll
            self.root.after(33, self._tick)
        else:
            self.root.after(100, self._poll_recording_start)

    def _tick(self):
        now  = time.perf_counter()
        left = max(0.0, self.phase_end - now)

        if self.state == self.STATE_PRESTART:
            self.lbl_timer.config(text=f"{math.ceil(left)}")
            self._update_progress_bar(1 - left / TIMING["pre_start_sec"])
            if now >= self.phase_end:
                self._begin_gesture()
            else:
                self.root.after(33, self._tick)

        elif self.state == self.STATE_COUNTDOWN:
            self.lbl_timer.config(text=f"{math.ceil(left)}")
            self._update_progress_bar(1 - left / TIMING["countdown_sec"])
            if now >= self.phase_end:
                self._begin_perform()
            else:
                self.root.after(33, self._tick)

        elif self.state == self.STATE_PERFORM:
            self.lbl_timer.config(text=f"{left:.1f}")
            self._update_progress_bar(1 - left / TIMING["gesture_sec"])
            if now >= self.phase_end:
                self._begin_rest()
            else:
                self.root.after(33, self._tick)

        elif self.state == self.STATE_REST:
            self.lbl_timer.config(text=f"{left:.1f}")
            self._update_progress_bar(1 - left / TIMING["rest_sec"])
            if now >= self.phase_end:
                self._after_rest()
            else:
                self.root.after(33, self._tick)

        elif self.state == self.STATE_BREAK:
            self.lbl_timer.config(text=f"{math.ceil(left)}")
            self._update_progress_bar(1 - left / TIMING["round_break_sec"])
            if now >= self.phase_end:
                self._begin_gesture()
            else:
                self.root.after(33, self._tick)

    def _begin_gesture(self):
        if self.gesture_idx >= len(self.all_gestures):
            self._finish_session()
            return
        gesture = self.all_gestures[self.gesture_idx]
        self.rep = 0
        self._draw_gesture(gesture)
        self._set_progress_header()
        self._begin_countdown()

    def _begin_countdown(self):
        n_reps = TIMING["reps_per_gesture"]
        self.state = self.STATE_COUNTDOWN
        self._set_state_color("countdown")
        self.lbl_state.config(
            text=f"GET READY   REP {self.rep + 1} / {n_reps}", fg=COLORS["text"])
        self.lbl_rep.config(text="")
        self._add_all("foot_hold", TIMING["countdown_sec"])
        self.phase_end = time.perf_counter() + TIMING["countdown_sec"]
        self.root.after(33, self._tick)

    def _begin_perform(self):
        gesture = self.all_gestures[self.gesture_idx]
        n_reps  = TIMING["reps_per_gesture"]
        self.state = self.STATE_PERFORM
        self._set_state_color("perform")
        self.lbl_state.config(text="G  O !", fg=COLORS["white"])
        self.lbl_rep.config(text=f"rep {self.rep + 1} of {n_reps}", fg=COLORS["white"])
        self._add_all(gesture, TIMING["gesture_sec"])
        self.phase_end = time.perf_counter() + TIMING["gesture_sec"]
        self.root.after(33, self._tick)

    def _begin_rest(self):
        self.state = self.STATE_REST
        self._set_state_color("rest")
        self.lbl_state.config(text="REST", fg=COLORS["white"])
        self.lbl_timer.config(text="")
        self.lbl_rep.config(text="return to neutral", fg=COLORS["white"])
        self._add_all("foot_hold", TIMING["rest_sec"])
        self.phase_end = time.perf_counter() + TIMING["rest_sec"]
        self.root.after(33, self._tick)

    def _after_rest(self):
        self.rep += 1
        n_reps = TIMING["reps_per_gesture"]
        if self.rep >= n_reps:
            # All reps for this gesture done — save checkpoint
            gesture = self.all_gestures[self.gesture_idx]
            self._save_checkpoint(gesture)
            self.gesture_idx += 1
            if self.gesture_idx == len(GESTURES_ROUND1):
                self._begin_round_break()
            elif self.gesture_idx >= len(self.all_gestures):
                self._finish_session()
            else:
                self._begin_gesture()
        else:
            self._begin_countdown()

    def _begin_round_break(self):
        self.state = self.STATE_BREAK
        self._set_state_color("break_col")
        self.lbl_state.config(text="ROUND 1 DONE — RELAX", fg=COLORS["white"])
        self.lbl_rep.config(text="Round 2 starts in...", fg=COLORS["white"])
        self._draw_gesture("foot_hold")
        self._add_all("foot_hold", TIMING["round_break_sec"])
        self.phase_end = time.perf_counter() + TIMING["round_break_sec"]
        self.root.after(33, self._tick)

    def _finish_session(self):
        self.state  = self.STATE_DONE
        self._elapsed     = time.perf_counter() - self.recording_start
        self._dg_meta     = self.dg.stop_recording()

        # Give MediaMTX 500ms to finalise files before querying paths
        self.root.after(500, self._finish_session_step2)

    def _finish_session_step2(self):
        elapsed     = self._elapsed
        dg_meta     = self._dg_meta
        mediamtx_files = self.dg.get_mediamtx_recording_paths(self.camera_names)

        # Get actual fps per camera from DroidGrid
        fps_map = self.dg.get_camera_fps(self.camera_names)

        # ── Save one label JSON per camera ──────────────────────────────────
        ts        = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_dir   = Path(self.args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        saved_paths = []

        for cam_name, tracker in self.trackers.items():
            video_file = (
                mediamtx_files.get(cam_name)
                or dg_meta.get("files", {}).get(cam_name)
                or f"{self.subject_id}_{cam_name}_{ts}.mp4"
            )
            actual_fps = fps_map.get(cam_name, self.fps)

            video_stem = Path(video_file).stem if video_file else f"{self.subject_id}_{cam_name}_{ts}"
            json_path  = out_dir / f"{video_stem}.json"

            tracker.save(
                str(json_path),
                video_file  = str(video_file),
                droidgrid_meta = dg_meta,
                actual_fps  = actual_fps,
            )
            saved_paths.append(json_path)

        # M10: Verify all files exist before deleting checkpoints
        if all(p.exists() and p.stat().st_size > 0 for p in saved_paths):
            if self.checkpoint_dir.exists():
                for cp in self.checkpoint_dir.glob("*.json"):
                    cp.unlink(missing_ok=True)
        else:
            print("[WARNING] Some label files may be empty — keeping checkpoints", file=sys.stderr)

        # UI update
        first_tracker = list(self.trackers.values())[0]
        self._set_state_color("done")
        self.lbl_gesture_name.config(text="SESSION DONE")
        self.lbl_state.config(text="Label JSONs saved", fg=COLORS["accent"])
        self.lbl_timer.config(text="✓")
        self.lbl_rep.config(
            text=f"{len(first_tracker.segments)} segments · {elapsed:.0f}s · {len(saved_paths)} file(s)",
            fg=COLORS["dim"])
        self.canvas.delete("all")
        self.lbl_help.config(text="ESC to exit")
        self._update_progress_bar(1.0)
        self.progress_bar.config(bg=COLORS["accent"])

        print(f"\n{'='*60}")
        print(f"Session complete.")
        print(f"Subject:  {self.subject_id}")
        print(f"Duration: {elapsed:.0f}s  ({first_tracker.total_frames} frames at {self.fps}fps nominal)")
        for p in saved_paths:
            print(f"Label:    {p}")
        print(f"{'='*60}\n")

        # ── Auto-export to FERN ──────────────────────────────────────────────
        if self.args.fern_export_dir or self.args.auto_export:
            self._run_fern_export(mediamtx_files, fps_map, saved_paths)


    def _run_fern_export(self, mediamtx_files: dict, fps_map: dict, saved_paths: list):
        """Run the post-recording FERN export pipeline."""
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from scripts.fern_export import export_to_fern

        fern_root = self.args.fern_export_dir
        if not fern_root:
            fern_root = "C:/fern/FERN_V2"

        # Build video_files dict from MediaMTX paths
        video_files = {}
        for cam_name in self.camera_names:
            vp = mediamtx_files.get(cam_name)
            if vp and Path(vp).exists():
                video_files[cam_name] = vp

        # Try to get fern_venv from profile
        fern_venv = "python"
        if self.args.profile:
            profile = load_profile(str(self.args.profile))
            if profile:
                fern_venv = profile.get("export", {}).get("fern_venv", "python")

        print(f"\n{'─'*60}")
        print(f"  FERN Export to: {fern_root}")
        print(f"{'─'*60}")

        result = export_to_fern(
            subject     = self.subject_id,
            label_dir   = self.args.output_dir,
            fern_root   = fern_root,
            fern_venv   = fern_venv,
            video_files = video_files,
            fps_map     = fps_map,
            extract_skeletons = True,
            verbose     = True,
        )

        if result.get("ok"):
            s = result["summary"]
            print(f"  ✓ FERN export complete: {s['labels_exported']} labels, "
                  f"{s['skeletons_extracted']} skeletons, {s['videos_copied']} videos")
        else:
            print(f"  ✗ FERN export had errors (check per-camera results above)")

    def _confirm_quit(self):
        if self.state not in [self.STATE_IDLE, self.STATE_DONE]:
            if not messagebox.askyesno(
                "Quit",
                "Session in progress.\n\nCheckpoints were saved after each gesture.\n"
                "Quit now? (final label JSON will NOT be saved)"
            ):
                return
        self.root.destroy()

    def emergency_save(self):
        """Crash recovery: persist trackers and stop server recording."""
        print("[assistant] CRASH — attempting emergency save", file=sys.stderr)
        try:
            if hasattr(self, 'trackers') and self.trackers:
                self._save_checkpoint("CRASH")
            print("[assistant] checkpoint saved", file=sys.stderr)
        except Exception as e:
            print(f"[assistant] checkpoint save failed: {e}", file=sys.stderr)
        try:
            if self.dg.enabled:
                self.dg.stop_recording()
                print("[assistant] server recording stopped", file=sys.stderr)
        except Exception as e:
            print(f"[assistant] could not stop recording: {e}", file=sys.stderr)

    def run(self):
        try:
            self.root.mainloop()
        except KeyboardInterrupt:
            pass
        except Exception:
            import traceback
            traceback.print_exc()
            self.emergency_save()
            sys.exit(1)


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="FERN v2 Recording Assistant v1.2")
    p.add_argument("--subject",       default="p_new",
                   help="Subject ID (e.g. p12)")
    p.add_argument("--output_dir",    default="data/new_recordings",
                   help="Directory to save label JSONs")
    p.add_argument("--fps",           type=int, default=TIMING["fps"],
                   help="Nominal camera FPS (default 30)")
    p.add_argument("--reps",          type=int, default=TIMING["reps_per_gesture"],
                   help="Repetitions per gesture (default 7)")
    p.add_argument("--sync_delay",    type=float, default=TIMING["sync_delay_sec"],
                   help="Extra pre-roll seconds after recording confirmed (default 1.0)")
    p.add_argument("--cameras",       default="",
                   help="Comma-separated camera names matching DroidGrid config "
                        "(e.g. phone1,phone2,phone3). Default: phone1")
    p.add_argument("--no_droidgrid",  action="store_true",
                   help="Run without DroidGrid integration")
    p.add_argument("--droidgrid_url", default=DROIDGRID_URL,
                   help=f"DroidGrid backend URL (default {DROIDGRID_URL})")
    p.add_argument("--camera_id",     type=int, default=0,
                   help="Legacy: camera_id for label JSON when using single camera")
    p.add_argument("--profile",       default=None,
                   help="Config profile name (e.g. fern). Loads defaults from "
                        "config/profiles/<name>.json")
    p.add_argument("--fern-export-dir", default=None,
                   help="FERN project root for auto-export "
                        "(e.g. C:/fern/FERN_V2). Implies --auto-export")
    p.add_argument("--auto-export",   action="store_true",
                   help="Automatically export labels + skeletons to FERN "
                        "after session ends")
    p.add_argument("--list_gestures", action="store_true",
                   help="Print gesture list and exit")

    args = p.parse_args()

    if args.list_gestures:
        print("Round 1:", GESTURES_ROUND1)
        print("Round 2:", GESTURES_ROUND2)
        print(f"Total: {len(GESTURES_ROUND1) * 2} gestures × {TIMING['reps_per_gesture']} reps")
        return

    # ── Profile merge ────────────────────────────────────────────────────────
    if args.profile:
        profile = load_profile(args.profile)
        if profile is None:
            print(f"[FATAL] Profile '{args.profile}' could not be loaded.", file=sys.stderr)
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
            export_cfg = profile.get("export", {})
            if export_cfg.get("fern_root"):
                args.fern_export_dir = export_cfg["fern_root"]
        print(f"[profile] Loaded '{args.profile}': {len(prof_defaults)} defaults, "
              f"export={'on' if args.fern_export_dir else 'off'}")

    if not HAS_REQUESTS and not args.no_droidgrid:
        print("WARNING: 'requests' not installed. DroidGrid disabled.")
        print("         Install: pip install requests")
        args.no_droidgrid = True

    # Apply CLI overrides
    TIMING["fps"]              = args.fps
    TIMING["reps_per_gesture"] = args.reps
    TIMING["sync_delay_sec"]   = args.sync_delay

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    app = RecordingAssistant(args)
    app.run()


if __name__ == "__main__":
    main()
