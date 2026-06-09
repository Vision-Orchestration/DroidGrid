#!/usr/bin/env python3
"""
recording_assistant.py — FERN v2 Guided Recording Assistant

Auto-guides gesture recording sessions with countdown, GO/REST signals,
auto-generated label JSONs, and optional DroidGrid REST integration.

Usage:
    python src/recording_assistant.py
    python src/recording_assistant.py --subject p12 --output_dir data/new_recordings
    python src/recording_assistant.py --subject p12 --no_droidgrid
    python src/recording_assistant.py --list_gestures

Requirements: pip install requests  (tkinter is stdlib)
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

GESTURES_ROUND2 = list(reversed(GESTURES_ROUND1))   # opposite order

TIMING = {
    "fps":            30,
    "countdown_sec":  3.0,    # before each rep — shows gesture image + 3..2..1
    "gesture_sec":    1.5,    # GO phase — subject performs
    "rest_sec":       1.0,    # REST phase — foot_hold between reps
    "reps_per_gesture": 7,
    "round_break_sec": 30.0,  # break between round 1 and round 2
    "pre_start_sec":   3.0,   # initial wait after recording starts
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

DROIDGRID_URL     = "http://localhost:3000"
DROIDGRID_API_START = "/api/recording/start"
DROIDGRID_API_STOP  = "/api/recording/stop"

COLORS = {
    "bg":        "#0a0a0a",
    "panel":     "#111111",
    "border":    "#222222",
    "countdown": "#d97706",   # amber
    "perform":   "#16a34a",   # green
    "rest":      "#1d4ed8",   # blue
    "break_col": "#7c3aed",   # purple
    "done":      "#374151",
    "text":      "#f9fafb",
    "dim":       "#6b7280",
    "accent":    "#22c55e",
    "white":     "#ffffff",
}

FONTS = {
    "title":    ("Helvetica", 16, "bold"),
    "gesture":  ("Helvetica", 42, "bold"),
    "state":    ("Helvetica", 26, "bold"),
    "cue":      ("Helvetica", 18),
    "timer":    ("Helvetica", 120, "bold"),
    "small":    ("Helvetica", 14),
    "rep":      ("Helvetica", 20, "bold"),
}

# ─── GESTURE DRAWINGS (tkinter Canvas, front-view lower body) ─────────────────

def _legs(c, cx, cy, s, color_l, color_r,
          lx=0, ly=0, la=0,   # left knee offset x, y (unused for now)
          rx=0, ry=0,          # right knee offset x, y
          rf_dx=0, rf_dy=0,    # right foot tip delta from right ankle
          lf_dx=-25, lf_dy=0): # left foot tip delta
    """Generic lower body drawing helper."""
    # Hip bar
    c.create_line(cx-40*s, cy-80*s, cx+40*s, cy-80*s, fill=COLORS["white"], width=int(4*s))
    # Left hip dot
    c.create_oval(cx-43*s, cy-83*s, cx-37*s, cy-77*s, fill=color_l, outline="")
    # Right hip dot
    c.create_oval(cx+37*s, cy-83*s, cx+43*s, cy-77*s, fill=color_r, outline="")

    # ── Left leg (always neutral) ──
    c.create_line(cx-35*s, cy-80*s, cx-35*s, cy-10*s, fill=color_l, width=int(5*s))   # thigh
    c.create_line(cx-35*s, cy-10*s, cx-35*s+lf_dx*s, cy+60*s, fill=color_l, width=int(5*s))  # shin
    # left foot
    c.create_line(cx-35*s+lf_dx*s, cy+60*s,
                  cx-35*s+lf_dx*s-25*s, cy+60*s,
                  fill=color_l, width=int(4*s), capstyle=tk.ROUND)
    # left ankle dot
    c.create_oval(cx-38*s+lf_dx*s, cy+57*s, cx-32*s+lf_dx*s, cy+63*s, fill=color_l, outline="")

    # ── Right leg (gesture position) ──
    knee_x = cx + 35*s + rx*s
    knee_y = cy - 10*s + ry*s
    c.create_line(cx+35*s, cy-80*s, knee_x, knee_y, fill=color_r, width=int(5*s))   # thigh
    # shin to ankle
    ankle_x = knee_x + rf_dx*s
    ankle_y = knee_y + 70*s + rf_dy*s
    c.create_line(knee_x, knee_y, ankle_x, ankle_y, fill=color_r, width=int(5*s))
    # foot
    c.create_line(ankle_x, ankle_y, ankle_x+25*s, ankle_y, fill=color_r, width=int(4*s), capstyle=tk.ROUND)
    # ankle dot
    c.create_oval(ankle_x-3*s, ankle_y-3*s, ankle_x+3*s, ankle_y+3*s, fill=color_r, outline="")


def draw_neutral(c, w, h):
    s = h / 280
    cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["dim"])


def draw_heel_tap(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"],
          rf_dx=0, rf_dy=0, lf_dx=-25)
    # Override foot to show heel-down, toe-up
    ankle_x = cx + 35*s; ankle_y = cy + 60*s
    c.create_line(ankle_x, ankle_y, ankle_x+30*s, ankle_y-18*s,
                  fill=COLORS["accent"], width=int(5*s), capstyle=tk.ROUND)
    c.create_oval(ankle_x-4*s, ankle_y-4*s, ankle_x+4*s, ankle_y+4*s,
                  fill="#fbbf24", outline="")  # heel highlight


def draw_foot_lift(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    # Right knee raised forward
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"],
          rx=20, ry=-55, rf_dx=0, rf_dy=-10)


def draw_sideway_kick(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    # Right leg extended sideways
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"],
          rx=60, ry=20, rf_dx=30, rf_dy=-30)
    # Arrow
    c.create_line(cx+60*s, cy+30*s, cx+130*s, cy+30*s,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)


def draw_forward_step(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"],
          rx=10, ry=10, rf_dx=20, rf_dy=-5)
    c.create_line(cx+60*s, cy+45*s, cx+90*s, cy+45*s,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)


def draw_forward_kick(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    # Right leg kicked forward and up
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"],
          rx=40, ry=-10, rf_dx=45, rf_dy=-35)
    c.create_line(cx+75*s, cy+20*s, cx+120*s, cy+5*s,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)


def draw_cross_front(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    # Right leg crossing to the left of left leg
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"],
          rx=-50, ry=10, rf_dx=-25, rf_dy=0)
    c.create_line(cx+35*s, cy, cx-20*s, cy,
                  fill=COLORS["accent"], width=int(2*s), arrow=tk.LAST)


def draw_flamingo_bend(c, w, h):
    s = h / 280; cx, cy = w//2, h//2 + 20
    # Right knee bent back, foot behind and up
    _legs(c, cx, cy, s, COLORS["dim"], COLORS["accent"],
          rx=5, ry=0, rf_dx=20, rf_dy=-80)
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

# ─── DROIDGRID CLIENT ─────────────────────────────────────────────────────────

class DroidGridClient:
    def __init__(self, base_url: str, enabled: bool = True):
        self.base_url = base_url.rstrip("/")
        self.enabled  = enabled and HAS_REQUESTS
        self.session_id = None

    def start_recording(self, subject_id: str) -> bool:
        if not self.enabled:
            return True
        try:
            r = requests.post(
                self.base_url + DROIDGRID_API_START,
                json={"subject_id": subject_id, "source": "recording_assistant"},
                timeout=3,
            )
            if r.status_code == 200:
                data = r.json()
                self.session_id = data.get("session_id") or data.get("id")
                print(f"[DroidGrid] Recording started. Session: {self.session_id}")
                return True
            print(f"[DroidGrid] Start failed: {r.status_code} {r.text}")
            return False
        except Exception as e:
            print(f"[DroidGrid] Start error: {e}")
            return False

    def stop_recording(self) -> dict:
        if not self.enabled:
            return {}
        try:
            r = requests.post(
                self.base_url + DROIDGRID_API_STOP,
                json={"session_id": self.session_id},
                timeout=3,
            )
            if r.status_code == 200:
                data = r.json()
                print(f"[DroidGrid] Recording stopped. File: {data.get('file')}")
                return data
            print(f"[DroidGrid] Stop failed: {r.status_code}")
            return {}
        except Exception as e:
            print(f"[DroidGrid] Stop error: {e}")
            return {}

# ─── LABEL TRACKER ────────────────────────────────────────────────────────────

class LabelTracker:
    """
    Tracks exact frame ranges for each phase and emits a label JSON
    in the same format used by label_videos_v3.py and fix_labels.py.
    """
    def __init__(self, fps: int, subject_id: str, camera_id: int = 0):
        self.fps         = fps
        self.subject_id  = subject_id
        self.camera_id   = camera_id
        self.segments    = []
        self._frame      = 0

    def add(self, gesture: str, duration_sec: float):
        n = round(duration_sec * self.fps)
        self.segments.append({
            "gesture":     gesture,
            "start_frame": self._frame,
            "end_frame":   self._frame + n - 1,
        })
        self._frame += n

    @property
    def total_frames(self):
        return self._frame

    def build_json(self, video_file: str = "", droidgrid_meta: dict = None) -> dict:
        gesture_order = [s["gesture"] for s in self.segments]
        # Deduplicate preserving order
        seen = set()
        unique_gestures = []
        for g in gesture_order:
            if g not in seen:
                seen.add(g)
                unique_gestures.append(g)

        return {
            "video_file":    video_file,
            "subject_id":    self.subject_id,
            "camera_id":     self.camera_id,
            "fps":           self.fps,
            "total_frames":  self.total_frames,
            "recorded_at":   datetime.now().isoformat(),
            "generator":     "recording_assistant_v1",
            "gesture_order": unique_gestures,
            "droidgrid":     droidgrid_meta or {},
            "segments":      self.segments,
        }

    def save(self, path: str, video_file: str = "", droidgrid_meta: dict = None):
        data = self.build_json(video_file, droidgrid_meta)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"[Labels] Saved → {path}  ({len(self.segments)} segments, {self.total_frames} frames)")
        return data

# ─── MAIN APP ─────────────────────────────────────────────────────────────────

class RecordingAssistant:

    STATE_IDLE       = "IDLE"
    STATE_PRESTART   = "PRESTART"
    STATE_COUNTDOWN  = "COUNTDOWN"
    STATE_PERFORM    = "PERFORM"
    STATE_REST       = "REST"
    STATE_NEXT       = "NEXT"
    STATE_BREAK      = "BREAK"
    STATE_DONE       = "DONE"

    def __init__(self, args):
        self.args       = args
        self.subject_id = args.subject
        self.fps        = TIMING["fps"]
        self.state      = self.STATE_IDLE
        self.dg         = DroidGridClient(args.droidgrid_url, not args.no_droidgrid)
        self.tracker    = LabelTracker(self.fps, self.subject_id, camera_id=0)

        # Session state
        self.all_gestures  = GESTURES_ROUND1 + GESTURES_ROUND2
        self.gesture_idx   = 0
        self.rep           = 0
        self.phase_end     = 0.0    # absolute time.perf_counter() when phase ends
        self.recording_start = 0.0  # when we actually started

        self._build_ui()

    # ── UI ──────────────────────────────────────────────────────────────────

    def _build_ui(self):
        self.root = tk.Tk()
        self.root.title("FERN Recording Assistant")
        self.root.configure(bg=COLORS["bg"])
        self.root.attributes("-fullscreen", True)

        # Allow ESC to exit
        self.root.bind("<Escape>", lambda e: self._confirm_quit())
        self.root.bind("<space>",  lambda e: self._on_space())

        W = self.root.winfo_screenwidth()
        H = self.root.winfo_screenheight()
        self.W, self.H = W, H

        # ── Header bar ──
        header = tk.Frame(self.root, bg=COLORS["panel"], height=60)
        header.pack(fill=tk.X, side=tk.TOP)
        header.pack_propagate(False)

        self.lbl_title = tk.Label(header, text="FERN  Recording Assistant",
                                   font=FONTS["title"], bg=COLORS["panel"],
                                   fg=COLORS["dim"])
        self.lbl_title.pack(side=tk.LEFT, padx=20, pady=12)

        self.lbl_subject = tk.Label(header, text=f"Subject: {self.subject_id}",
                                     font=FONTS["title"], bg=COLORS["panel"],
                                     fg=COLORS["text"])
        self.lbl_subject.pack(side=tk.LEFT, padx=30, pady=12)

        self.lbl_progress = tk.Label(header, text="", font=FONTS["title"],
                                      bg=COLORS["panel"], fg=COLORS["dim"])
        self.lbl_progress.pack(side=tk.RIGHT, padx=20, pady=12)

        # ── Main body: left = drawing, right = state ──
        body = tk.Frame(self.root, bg=COLORS["bg"])
        body.pack(fill=tk.BOTH, expand=True)

        # Left panel — gesture drawing
        left_w = int(W * 0.38)
        left_frame = tk.Frame(body, bg=COLORS["panel"],
                               width=left_w, bd=0, highlightthickness=0)
        left_frame.pack(side=tk.LEFT, fill=tk.Y, padx=(20, 10), pady=20)
        left_frame.pack_propagate(False)

        self.lbl_gesture_name = tk.Label(left_frame, text="",
                                          font=FONTS["gesture"],
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

        # Right panel — countdown and state
        right_frame = tk.Frame(body, bg=COLORS["bg"])
        right_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True,
                          padx=(10, 20), pady=20)

        self.state_banner = tk.Frame(right_frame, bg=COLORS["bg"], bd=0)
        self.state_banner.pack(fill=tk.BOTH, expand=True)

        self.lbl_state = tk.Label(self.state_banner, text="PRESS  SPACE  TO  START",
                                   font=FONTS["state"], bg=COLORS["bg"],
                                   fg=COLORS["dim"])
        self.lbl_state.pack(pady=(40, 10))

        self.lbl_timer = tk.Label(self.state_banner, text="",
                                   font=FONTS["timer"], bg=COLORS["bg"],
                                   fg=COLORS["text"])
        self.lbl_timer.pack(pady=0)

        self.lbl_rep = tk.Label(self.state_banner, text="",
                                 font=FONTS["rep"], bg=COLORS["bg"],
                                 fg=COLORS["dim"])
        self.lbl_rep.pack(pady=10)

        # Progress bar (bottom of right panel)
        self.progress_bar_bg = tk.Frame(self.state_banner, bg=COLORS["border"],
                                         height=8)
        self.progress_bar_bg.pack(fill=tk.X, side=tk.BOTTOM, padx=0, pady=20)
        self.progress_bar = tk.Frame(self.progress_bar_bg, bg=COLORS["dim"],
                                      height=8, width=0)
        self.progress_bar.place(x=0, y=0, relheight=1)

        # Bottom help
        self.lbl_help = tk.Label(self.root,
                                  text="SPACE = start/pause   ESC = quit",
                                  font=FONTS["small"], bg=COLORS["bg"],
                                  fg=COLORS["dim"])
        self.lbl_help.pack(side=tk.BOTTOM, pady=8)

        self._draw_gesture("foot_hold")

    def _draw_gesture(self, gesture: str):
        self.canvas.delete("all")
        fn = DRAW_FNS.get(gesture, draw_neutral)
        cw = self.canvas.winfo_width() or (int(self.W * 0.38) - 40)
        ch = self.canvas.winfo_height() or int(self.H * 0.38)
        fn(self.canvas, cw, ch)
        display_name = gesture.replace("_", "  ").upper()
        self.lbl_gesture_name.config(text=display_name)
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
        done  = self.gesture_idx
        rnd   = "Round 1" if self.gesture_idx < len(GESTURES_ROUND1) else "Round 2"
        self.lbl_progress.config(
            text=f"{rnd}   {done}/{total} gestures"
        )

    # ── Session flow ─────────────────────────────────────────────────────────

    def _on_space(self):
        if self.state == self.STATE_IDLE:
            self._start_session()

    def _start_session(self):
        # DroidGrid
        if not self.args.no_droidgrid:
            ok = self.dg.start_recording(self.subject_id)
            if not ok:
                if not messagebox.askyesno(
                    "DroidGrid",
                    "Could not connect to DroidGrid.\nContinue without recording?",
                ):
                    return

        self.recording_start = time.perf_counter()
        self.gesture_idx = 0
        self.rep = 0

        # Pre-start foot_hold
        self.tracker.add("foot_hold", TIMING["pre_start_sec"])
        self._set_state_color("done")
        self.lbl_state.config(text="STARTING IN...")
        self.lbl_timer.config(text="")
        self.state = self.STATE_PRESTART
        self.phase_end = time.perf_counter() + TIMING["pre_start_sec"]
        self.root.after(50, self._tick)

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
            pct = 1 - left / TIMING["countdown_sec"]
            self._update_progress_bar(pct)
            if now >= self.phase_end:
                self._begin_perform()
            else:
                self.root.after(33, self._tick)

        elif self.state == self.STATE_PERFORM:
            self.lbl_timer.config(text=f"{left:.1f}")
            pct = 1 - left / TIMING["gesture_sec"]
            self._update_progress_bar(pct)
            if now >= self.phase_end:
                self._begin_rest()
            else:
                self.root.after(33, self._tick)

        elif self.state == self.STATE_REST:
            self.lbl_timer.config(text=f"{left:.1f}")
            pct = 1 - left / TIMING["rest_sec"]
            self._update_progress_bar(pct)
            if now >= self.phase_end:
                self._after_rest()
            else:
                self.root.after(33, self._tick)

        elif self.state == self.STATE_BREAK:
            self.lbl_timer.config(text=f"{math.ceil(left)}")
            pct = 1 - left / TIMING["round_break_sec"]
            self._update_progress_bar(pct)
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
        gesture = self.all_gestures[self.gesture_idx]
        n_reps  = TIMING["reps_per_gesture"]

        self.state = self.STATE_COUNTDOWN
        self._set_state_color("countdown")
        self.lbl_state.config(text=f"GET READY   REP {self.rep + 1} / {n_reps}",
                               fg=COLORS["text"])
        self.lbl_rep.config(text="")

        # Track countdown as foot_hold
        self.tracker.add("foot_hold", TIMING["countdown_sec"])
        self.phase_end = time.perf_counter() + TIMING["countdown_sec"]
        self.root.after(33, self._tick)

    def _begin_perform(self):
        gesture = self.all_gestures[self.gesture_idx]
        n_reps  = TIMING["reps_per_gesture"]

        self.state = self.STATE_PERFORM
        self._set_state_color("perform")
        self.lbl_state.config(text="G  O !", fg=COLORS["white"])
        self.lbl_rep.config(text=f"rep {self.rep + 1} of {n_reps}", fg=COLORS["white"])

        self.tracker.add(gesture, TIMING["gesture_sec"])
        self.phase_end = time.perf_counter() + TIMING["gesture_sec"]
        self.root.after(33, self._tick)

    def _begin_rest(self):
        self.state = self.STATE_REST
        self._set_state_color("rest")
        self.lbl_state.config(text="REST", fg=COLORS["white"])
        self.lbl_timer.config(text="")
        self.lbl_rep.config(text="return to neutral", fg=COLORS["white"])

        self.tracker.add("foot_hold", TIMING["rest_sec"])
        self.phase_end = time.perf_counter() + TIMING["rest_sec"]
        self.root.after(33, self._tick)

    def _after_rest(self):
        self.rep += 1
        n_reps = TIMING["reps_per_gesture"]

        if self.rep >= n_reps:
            # Done with this gesture
            self.gesture_idx += 1

            # Check if we hit the round break
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

        self.tracker.add("foot_hold", TIMING["round_break_sec"])
        self.phase_end = time.perf_counter() + TIMING["round_break_sec"]
        self.root.after(33, self._tick)

    def _finish_session(self):
        self.state = self.STATE_DONE
        elapsed = time.perf_counter() - self.recording_start

        # Stop DroidGrid
        dg_meta = self.dg.stop_recording()

        # Save label JSON
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        video_file = dg_meta.get("file", f"{self.subject_id}_c3_{ts}.mp4")
        json_name  = Path(video_file).stem + ".json"
        json_path  = Path(self.args.output_dir) / json_name
        self.tracker.save(str(json_path), video_file, dg_meta)

        # UI
        self._set_state_color("done")
        self.lbl_gesture_name.config(text="SESSION DONE")
        self.lbl_state.config(
            text=f"Label JSON saved",
            fg=COLORS["accent"],
        )
        self.lbl_timer.config(text="✓")
        self.lbl_rep.config(
            text=f"{len(self.tracker.segments)} segments · {elapsed:.0f}s · {json_path}",
            fg=COLORS["dim"],
        )
        self.canvas.delete("all")
        self.lbl_help.config(text="ESC to exit")
        self._update_progress_bar(1.0)
        self.progress_bar.config(bg=COLORS["accent"])

        print(f"\n{'='*60}")
        print(f"Session complete.")
        print(f"Subject:  {self.subject_id}")
        print(f"Duration: {elapsed:.0f}s")
        print(f"Frames:   {self.tracker.total_frames} (at {self.fps}fps)")
        print(f"Label:    {json_path}")
        print(f"{'='*60}\n")

    def _confirm_quit(self):
        if self.state not in [self.STATE_IDLE, self.STATE_DONE]:
            if not messagebox.askyesno("Quit", "Session in progress. Quit now?\n(Label JSON will NOT be saved)"):
                return
        self.root.destroy()

    def run(self):
        self.root.mainloop()

# ─── ENTRY POINT ──────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="FERN v2 Recording Assistant")
    p.add_argument("--subject",       default="p_new",
                   help="Subject ID (e.g. p12)")
    p.add_argument("--output_dir",    default="data/new_recordings",
                   help="Directory to save label JSONs")
    p.add_argument("--fps",           type=int, default=30,
                   help="Camera FPS (default 30)")
    p.add_argument("--reps",          type=int, default=7,
                   help="Repetitions per gesture (default 7)")
    p.add_argument("--no_droidgrid",  action="store_true",
                   help="Run without DroidGrid integration")
    p.add_argument("--droidgrid_url", default=DROIDGRID_URL,
                   help=f"DroidGrid backend URL (default {DROIDGRID_URL})")
    p.add_argument("--camera_id",     type=int, default=0,
                   help="Camera ID for label JSON (0=c3 front)")
    p.add_argument("--list_gestures", action="store_true",
                   help="Print gesture list and exit")

    args = p.parse_args()

    if args.list_gestures:
        print("Round 1:", GESTURES_ROUND1)
        print("Round 2:", GESTURES_ROUND2)
        print(f"Total: {len(GESTURES_ROUND1) * 2} gestures × {TIMING['reps_per_gesture']} reps each")
        return

    if not HAS_REQUESTS and not args.no_droidgrid:
        print("WARNING: 'requests' not installed. DroidGrid disabled.")
        print("         Install: pip install requests")
        print("         Or run with --no_droidgrid\n")
        args.no_droidgrid = True

    # Apply CLI overrides
    TIMING["fps"]              = args.fps
    TIMING["reps_per_gesture"] = args.reps

    Path(args.output_dir).mkdir(parents=True, exist_ok=True)
    app = RecordingAssistant(args)
    app.run()


if __name__ == "__main__":
    main()
