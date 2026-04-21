#!/usr/bin/env python3
"""
DroidGrid — Multi-Phone DroidCam Controller
============================================
Simultaneous live preview, recording and snapshot from multiple
Android phones running DroidCam, served over Wi-Fi MJPEG.

Controls (keyboard, focus the preview window):
  R  — Start recording all connected cameras
  S  — Stop  recording  (auto-increments repeat counter)
  T  — Snapshot: save one JPEG from every camera right now
  G  — Set Gesture / Session label    (opens terminal prompt)
  P  — Set Person  ID                 (opens terminal prompt)
  N  — Set Repeat  number             (opens terminal prompt)
  C  — Reconnect all cameras
  H  — Toggle HUD overlay on/off
  Q  — Quit

Recordings: recordings/<label>_<person>_<repeat>_<camera>_<ts>.mp4
Snapshots : snapshots/<label>_<person>_<repeat>_<camera>_<ts>.jpg
"""

# ─── stdlib ────────────────────────────────────────────────────────────────
import cv2
import numpy as np
import threading
import queue
import hashlib
import time
import os
import sys
import logging
from datetime import datetime
from typing import Optional

# ─── logging ───────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("droidgrid")


# ══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION  ─ edit this section before running
# ══════════════════════════════════════════════════════════════════════════════

CAMERAS = [
    # name        ip / URL                                    W     H    fps
    {"name": "Phone-1", "ip": "192.168.137.107", "port": 4747, "res": (1280, 720), "fps": 30},
    {"name": "Phone-2", "ip": "192.168.137.226", "port": 4747, "res": (1280, 720), "fps": 30},
    {"name": "Phone-3", "ip": "192.168.137.39",  "port": 4747, "res": (1280, 720), "fps": 30},
    {"name": "Phone-4", "ip": "192.168.137.35",  "port": 4747, "res": (1280, 720), "fps": 30},
    {"name": "Phone-5", "ip": "192.168.137.49",  "port": 4747, "res": (1280, 720), "fps": 30},
]

# Output directories (created automatically)
RECORD_DIR   = "recordings"
SNAPSHOT_DIR = "snapshots"

# File naming pattern — available tokens: {label} {person} {repeat} {camera} {date} {time}
NAMING_PATTERN = "{label}_{person}_{repeat}_{camera}"

# Grid display: each cell is this size (pixels)
CELL_W = 640
CELL_H = 360

# Codec used for .mp4 output.  mp4v = MPEG-4 (most compatible)
CODEC = "mp4v"

# Frozen-frame detection: if hash is same for this many consecutive frames → reconnect
FREEZE_THRESHOLD = 60   # frames  (~2 s at 30 fps)

# Reconnect back-off
RECONNECT_DELAY = 2.0   # seconds between reconnect attempts


# ══════════════════════════════════════════════════════════════════════════════
#  CAMERA  —  one instance per phone
# ══════════════════════════════════════════════════════════════════════════════

class Camera:
    """
    Manages one MJPEG stream:
      • Capture thread  → reads frames, detects freezes, reconnects automatically
      • Writer  thread  → drains a queue and writes to VideoWriter (non-blocking)
      • Snapshot method → saves current frame as JPEG
    """

    def __init__(self, cfg: dict):
        self.name   = cfg["name"]
        self.ip     = cfg["ip"]
        self.port   = cfg["port"]
        self.res    = cfg["res"]          # (width, height) for recording
        self.fps    = cfg["fps"]

        self._log   = logging.getLogger(f"cam.{self.name}")

        # State
        self.connected   = False
        self.running     = False
        self.recording   = False

        # Shared frame (display, low-res)
        self._display_frame: Optional[np.ndarray] = None
        self._frame_lock    = threading.Lock()

        # Stats
        self.frame_count   = 0
        self.drop_count    = 0
        self._fps_counter  = 0
        self._fps_ts       = time.time()
        self.live_fps      = 0.0

        # Freeze detection
        self._last_hash    = b""
        self._same_count   = 0

        # Writer queue (unbounded — writer thread drains it)
        self._write_q:  queue.Queue = queue.Queue(maxsize=0)
        self._writer:   Optional[cv2.VideoWriter] = None
        self._writer_th: Optional[threading.Thread] = None

        self._cap: Optional[cv2.VideoCapture] = None

    # ── public URL ─────────────────────────────────────────────────────────

    @property
    def url(self) -> str:
        w, h = self.res
        return f"http://{self.ip}:{self.port}/mjpegfeed?{w}x{h}"

    # ── connection ─────────────────────────────────────────────────────────

    def connect(self) -> bool:
        self._release_cap()
        try:
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not cap.isOpened():
                self._log.warning("Could not open stream at %s", self.url)
                cap.release()
                return False
            # Warm-up read
            ok, _ = cap.read()
            if not ok:
                cap.release()
                return False
            self._cap = cap
            self.connected = True
            self._same_count = 0
            self._last_hash  = b""
            self._log.info("Connected  %s", self.url)
            return True
        except Exception as exc:
            self._log.error("connect() error: %s", exc)
            return False

    def _release_cap(self):
        if self._cap:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None
        self.connected = False

    # ── capture thread ─────────────────────────────────────────────────────

    def start(self):
        self.running = True
        t = threading.Thread(target=self._capture_loop, daemon=True, name=f"cap-{self.name}")
        t.start()

    def stop(self):
        self.running = False
        self.stop_recording()
        self._release_cap()

    def _capture_loop(self):
        self._log.info("Capture thread started")
        while self.running:
            if not self.connected:
                self._log.info("Attempting reconnect…")
                if not self.connect():
                    time.sleep(RECONNECT_DELAY)
                    continue

            ok, frame = False, None
            try:
                ok, frame = self._cap.read()
            except Exception as exc:
                self._log.warning("read() exception: %s", exc)

            if not ok or frame is None:
                self.drop_count += 1
                if self.drop_count % 10 == 0:
                    self._log.warning("%d consecutive drops — reconnecting", self.drop_count)
                    self.connected = False
                continue

            self.drop_count = 0
            self.frame_count += 1

            # ── freeze detection ───────────────────────────────────────────
            fhash = hashlib.md5(frame[::8, ::8].tobytes()).digest()
            if fhash == self._last_hash:
                self._same_count += 1
                if self._same_count >= FREEZE_THRESHOLD:
                    self._log.warning("Frozen frame detected — reconnecting")
                    self.connected = False
                    self._same_count = 0
                    continue
            else:
                self._same_count = 0
            self._last_hash = fhash

            # ── live FPS counter ───────────────────────────────────────────
            self._fps_counter += 1
            now = time.time()
            if now - self._fps_ts >= 1.0:
                self.live_fps = self._fps_counter / (now - self._fps_ts)
                self._fps_counter = 0
                self._fps_ts = now

            # ── store display frame (high-quality preview resize) ───────────
            fh, fw = frame.shape[:2]
            if (fw, fh) == (CELL_W, CELL_H):
                disp = frame.copy()
            else:
                # Use better interpolation than linear to avoid a soft/blurry preview.
                interp = cv2.INTER_AREA if fw >= CELL_W and fh >= CELL_H else cv2.INTER_CUBIC
                disp = cv2.resize(frame, (CELL_W, CELL_H), interpolation=interp)
            with self._frame_lock:
                self._display_frame = disp

            # ── push to writer queue ───────────────────────────────────────
            if self.recording:
                try:
                    self._write_q.put_nowait(frame)
                except queue.Full:
                    pass   # drop rather than block

        self._log.info("Capture thread exited")

    # ── display ────────────────────────────────────────────────────────────

    def get_display_frame(self) -> np.ndarray:
        with self._frame_lock:
            if self._display_frame is not None:
                return self._display_frame.copy()
        # placeholder when offline
        ph = np.zeros((CELL_H, CELL_W, 3), dtype=np.uint8)
        cv2.putText(ph, self.name,     (CELL_W//2 - 50, CELL_H//2 - 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (60, 60, 60), 2, cv2.LINE_AA)
        cv2.putText(ph, "OFFLINE",     (CELL_W//2 - 48, CELL_H//2 + 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (40, 40, 160), 2, cv2.LINE_AA)
        return ph

    # ── recording ──────────────────────────────────────────────────────────

    def start_recording(self, filepath: str) -> bool:
        if self.recording:
            return False
        w, h = self.res
        fourcc = cv2.VideoWriter_fourcc(*CODEC)
        writer = cv2.VideoWriter(filepath, fourcc, float(self.fps), (w, h))
        if not writer.isOpened():
            writer.release()
            self._log.error("VideoWriter failed: %s", filepath)
            return False
        self._writer = writer
        self.recording = True
        self._writer_th = threading.Thread(
            target=self._writer_loop, daemon=True, name=f"wr-{self.name}")
        self._writer_th.start()
        self._log.info("Recording → %s", os.path.basename(filepath))
        return True

    def stop_recording(self):
        if not self.recording:
            return
        self.recording = False
        self._write_q.put(None)   # sentinel
        if self._writer_th:
            self._writer_th.join(timeout=5.0)
        self._log.info("Recording stopped  (queued frames flushed)")

    def _writer_loop(self):
        """Drain the write queue into the VideoWriter — runs in its own thread."""
        while True:
            try:
                item = self._write_q.get(timeout=1.0)
            except queue.Empty:
                if not self.recording:
                    break
                continue
            if item is None:
                break
            w, h = self.res
            frame = item if (item.shape[1] == w and item.shape[0] == h) \
                    else cv2.resize(item, (w, h))
            self._writer.write(frame)
        if self._writer:
            self._writer.release()
            self._writer = None
        # drain any leftover items
        while not self._write_q.empty():
            try:
                self._write_q.get_nowait()
            except queue.Empty:
                break

    # ── snapshot ───────────────────────────────────────────────────────────

    def save_snapshot(self, filepath: str) -> bool:
        """Save current raw display frame as JPEG."""
        with self._frame_lock:
            frame = self._display_frame.copy() if self._display_frame is not None else None
        if frame is None:
            self._log.warning("No frame available for snapshot")
            return False
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        ok = cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        if ok:
            self._log.info("Snapshot → %s", os.path.basename(filepath))
        return ok


# ══════════════════════════════════════════════════════════════════════════════
#  SESSION — naming helper
# ══════════════════════════════════════════════════════════════════════════════

class Session:
    def __init__(self):
        self.label  = "session"
        self.person = "p01"
        self.repeat = "r01"

    def _tokens(self, camera_name: str) -> dict:
        now = datetime.now()
        return {
            "label":  self.label,
            "person": self.person,
            "repeat": self.repeat,
            "camera": camera_name,
            "date":   now.strftime("%Y%m%d"),
            "time":   now.strftime("%H%M%S"),
        }

    def make_video_path(self, camera_name: str) -> str:
        base = NAMING_PATTERN.format(**self._tokens(camera_name))
        path = os.path.join(RECORD_DIR, f"{base}.mp4")
        return _safe_path(path)

    def make_snapshot_path(self, camera_name: str) -> str:
        tokens = self._tokens(camera_name)
        base = NAMING_PATTERN.format(**tokens)
        ts   = f"{tokens['date']}_{tokens['time']}"
        path = os.path.join(SNAPSHOT_DIR, f"{base}_{ts}.jpg")
        return _safe_path(path)

    def auto_next_repeat(self):
        try:
            n = int(self.repeat.lstrip("r")) + 1
            self.repeat = f"r{n:02d}"
        except ValueError:
            pass


def _safe_path(path: str) -> str:
    """Append _N suffix if file already exists to prevent overwrite."""
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 1
    while os.path.exists(f"{base}_{i}{ext}"):
        i += 1
    return f"{base}_{i}{ext}"


# ══════════════════════════════════════════════════════════════════════════════
#  HUD  — overlay drawn on the grid
# ══════════════════════════════════════════════════════════════════════════════

_FONT  = cv2.FONT_HERSHEY_SIMPLEX
_MONO  = cv2.FONT_HERSHEY_DUPLEX


def _draw_cell_hud(cell: np.ndarray, cam: Camera, recording: bool) -> np.ndarray:
    """Draw status overlay on a single camera cell."""
    h, w = cell.shape[:2]
    out = cell.copy()

    # semi-transparent top bar
    bar = out[0:30, :].copy()
    cv2.rectangle(out, (0, 0), (w, 30), (0, 0, 0), -1)
    cv2.addWeighted(out[0:30], 0.55, bar, 0.45, 0, out[0:30])

    # camera name
    cv2.putText(out, cam.name, (8, 21), _FONT, 0.58, (255, 255, 255), 1, cv2.LINE_AA)

    # connection status + FPS
    if cam.connected:
        status_col = (80, 220, 80)
        status_txt = f"LIVE  {cam.live_fps:4.1f} fps"
    else:
        status_col = (60, 60, 200)
        status_txt = "OFFLINE"
    cv2.putText(out, status_txt, (w - 160, 21), _FONT, 0.52, status_col, 1, cv2.LINE_AA)

    # REC badge
    if recording and cam.recording:
        cv2.rectangle(out, (0, 0), (w, h), (0, 0, 180), 3)
        cv2.rectangle(out, (w - 68, 36), (w - 4, 58), (0, 0, 0), -1)
        cv2.circle(out, (w - 56, 47), 7, (0, 0, 230), -1)
        cv2.putText(out, "REC", (w - 46, 52), _FONT, 0.50, (255, 255, 255), 1, cv2.LINE_AA)

    # frame counter (bottom-left)
    cv2.putText(out, f"#{cam.frame_count}", (8, h - 8),
                _FONT, 0.40, (160, 160, 160), 1, cv2.LINE_AA)

    # drop counter
    if cam.drop_count > 0:
        cv2.putText(out, f"drop:{cam.drop_count}", (w - 100, h - 8),
                    _FONT, 0.40, (80, 80, 220), 1, cv2.LINE_AA)

    return out


def _draw_top_bar(grid: np.ndarray, sess: Session,
                  recording: bool, status: str, hud: bool) -> np.ndarray:
    bar_h = 54
    bar = np.zeros((bar_h, grid.shape[1], 3), dtype=np.uint8)
    bg = (28, 4, 4) if recording else (18, 18, 18)
    bar[:] = bg

    # status line
    status_col = (100, 180, 255) if not recording else (80, 80, 255)
    cv2.putText(bar, status, (12, 22), _FONT, 0.58, status_col, 1, cv2.LINE_AA)

    # session meta
    meta = (f"Label: {sess.label}   Person: {sess.person}   "
            f"Repeat: {sess.repeat}   HUD: {'ON' if hud else 'OFF'}")
    cv2.putText(bar, meta, (12, 46), _FONT, 0.41, (140, 160, 180), 1, cv2.LINE_AA)

    # controls hint (right side)
    hint = "R:Rec  S:Stop  T:Snap  G/P/N:Label  C:Reconnect  H:HUD  Q:Quit"
    tw = cv2.getTextSize(hint, _FONT, 0.37, 1)[0][0]
    cv2.putText(bar, hint, (grid.shape[1] - tw - 10, 46),
                _FONT, 0.37, (90, 90, 90), 1, cv2.LINE_AA)

    return np.vstack([bar, grid])


# ══════════════════════════════════════════════════════════════════════════════
#  INLINE PROMPT  — non-blocking text input drawn in the grid
# ══════════════════════════════════════════════════════════════════════════════

class InlinePrompt:
    """
    Shows a text-input overlay drawn on top of the grid.
    Collects keypresses from cv2.waitKey() — no terminal input() needed.
    """

    def __init__(self, field: str, current: str):
        self.field   = field
        self.value   = current
        self.active  = True
        self.cursor  = len(current)

    def handle_key(self, key: int) -> bool:
        """Return True when input is committed (Enter) or cancelled (Esc)."""
        if key == 13 or key == 10:    # Enter
            self.active = False
            return True
        if key == 27:                 # Esc — cancel, restore original
            self.active = False
            return True
        if key == 8 or key == 127:    # Backspace
            if self.cursor > 0:
                self.value = self.value[:self.cursor-1] + self.value[self.cursor:]
                self.cursor -= 1
        elif 32 <= key <= 126:        # Printable ASCII
            ch = chr(key)
            self.value = self.value[:self.cursor] + ch + self.value[self.cursor:]
            self.cursor += 1
        return False

    def draw(self, frame: np.ndarray) -> np.ndarray:
        h, w = frame.shape[:2]
        out = frame.copy()
        # darken background
        overlay = out.copy()
        cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.55, out, 0.45, 0, out)
        # box
        bx1, by1, bx2, by2 = w//2 - 260, h//2 - 45, w//2 + 260, h//2 + 45
        cv2.rectangle(out, (bx1, by1), (bx2, by2), (35, 35, 35), -1)
        cv2.rectangle(out, (bx1, by1), (bx2, by2), (100, 140, 200), 2)
        # label
        cv2.putText(out, f"Set {self.field}:", (bx1 + 14, by1 + 28),
                    _FONT, 0.62, (180, 210, 255), 1, cv2.LINE_AA)
        # input text + cursor
        display_val = self.value + ("|" if int(time.time() * 2) % 2 == 0 else " ")
        cv2.putText(out, display_val, (bx1 + 14, by2 - 14),
                    _MONO, 0.65, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(out, "Enter=Confirm   Esc=Cancel",
                    (bx1 + 14, by2 + 20), _FONT, 0.38, (100, 100, 100), 1, cv2.LINE_AA)
        return out


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN APP
# ══════════════════════════════════════════════════════════════════════════════

class DroidGrid:

    def __init__(self):
        self.cameras   = [Camera(c) for c in CAMERAS]
        self.session   = Session()
        self.recording = False
        self.hud       = True
        self._status   = "Ready — press R to start recording"
        self._prompt: Optional[InlinePrompt] = None   # active inline prompt

        os.makedirs(RECORD_DIR,   exist_ok=True)
        os.makedirs(SNAPSHOT_DIR, exist_ok=True)

    # ── startup ────────────────────────────────────────────────────────────

    def connect_all(self):
        log.info("Connecting to %d cameras…", len(self.cameras))
        threads = [
            threading.Thread(target=self._connect_one, args=(c,), daemon=True)
            for c in self.cameras
        ]
        for t in threads: t.start()
        for t in threads: t.join(timeout=10)
        ok = sum(c.connected for c in self.cameras)
        log.info("%d / %d cameras connected", ok, len(self.cameras))

    def _connect_one(self, cam: Camera):
        cam.connect()
        icon = "✓" if cam.connected else "✗"
        log.info("  %s  %s  (%s)", icon, cam.name, cam.ip)

    def start_all(self):
        for cam in self.cameras:
            cam.start()

    # ── recording ──────────────────────────────────────────────────────────

    def start_recording(self):
        if self.recording:
            self._status = "Already recording — press S to stop"
            return
        started = 0
        for cam in self.cameras:
            if not cam.connected:
                log.warning("%s offline — skipped", cam.name)
                continue
            path = self.session.make_video_path(cam.name)
            if cam.start_recording(path):
                started += 1
        if started == 0:
            self._status = "No cameras available to record"
            return
        self.recording = True
        self._status = (f"● REC  {self.session.label} / {self.session.person} / "
                        f"{self.session.repeat}  — {started} cameras")
        log.info("Recording started  (%d cameras)", started)

    def stop_recording(self):
        if not self.recording:
            self._status = "Not recording"
            return
        for cam in self.cameras:
            cam.stop_recording()
        self.recording = False
        self._status = f"Saved to {RECORD_DIR}/"
        log.info("Recording stopped")
        self.session.auto_next_repeat()

    # ── snapshot ───────────────────────────────────────────────────────────

    def take_snapshots(self):
        saved = 0
        for cam in self.cameras:
            if not cam.connected:
                continue
            path = cam.save_snapshot(self.session.make_snapshot_path(cam.name))
            if path:
                saved += 1
        self._status = f"Snapshots saved: {saved} files in {SNAPSHOT_DIR}/"
        log.info("Snapshots taken: %d", saved)

    # ── grid rendering ─────────────────────────────────────────────────────

    def _build_grid(self) -> np.ndarray:
        n = len(self.cameras)
        cols = 3
        rows = (n + cols - 1) // cols

        cells = []
        for cam in self.cameras:
            cell = cam.get_display_frame()
            if self.hud:
                cell = _draw_cell_hud(cell, cam, self.recording)
            cells.append(cell)

        # pad to full grid
        blank = np.zeros((CELL_H, CELL_W, 3), dtype=np.uint8)
        while len(cells) % cols:
            cells.append(blank)

        rows_imgs = [
            np.hstack(cells[r * cols:(r + 1) * cols])
            for r in range(rows)
        ]
        grid = np.vstack(rows_imgs)
        grid = _draw_top_bar(grid, self.session, self.recording, self._status, self.hud)
        return grid

    # ── main loop ──────────────────────────────────────────────────────────

    def run(self):
        win = "DroidGrid"
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(win, CELL_W * 3, CELL_H * 2 + 54)

        log.info("UI started — press H for help overlay")

        try:
            while True:
                grid = self._build_grid()

                if self._prompt and self._prompt.active:
                    grid = self._prompt.draw(grid)

                cv2.imshow(win, grid)
                key = cv2.waitKey(30) & 0xFF

                if self._prompt and self._prompt.active:
                    done = self._prompt.handle_key(key)
                    if done:
                        self._apply_prompt(self._prompt)
                    continue

                if key == ord('q') or key == 27:
                    log.info("Quit requested")
                    break
                elif key == ord('r'):
                    self.start_recording()
                elif key == ord('s'):
                    self.stop_recording()
                elif key == ord('t'):
                    self.take_snapshots()
                elif key == ord('g'):
                    self._prompt = InlinePrompt("Label (gesture)", self.session.label)
                elif key == ord('p'):
                    self._prompt = InlinePrompt("Person ID", self.session.person)
                elif key == ord('n'):
                    self._prompt = InlinePrompt("Repeat", self.session.repeat)
                elif key == ord('c'):
                    self._reconnect_all()
                elif key == ord('h'):
                    self.hud = not self.hud
                    self._status = f"HUD {'ON' if self.hud else 'OFF'}"

        except KeyboardInterrupt:
            pass
        finally:
            self._shutdown()

    def _apply_prompt(self, prompt: InlinePrompt):
        field = prompt.field
        val   = prompt.value.strip()
        if not val:
            return
        if   "Label"  in field: self.session.label  = val
        elif "Person" in field: self.session.person = val
        elif "Repeat" in field: self.session.repeat = val
        self._status = f"{field} → {val}"
        self._prompt = None

    def _reconnect_all(self):
        self._status = "Reconnecting…"
        def _do():
            for cam in self.cameras:
                cam.connect()
            ok = sum(c.connected for c in self.cameras)
            self._status = f"Reconnected: {ok}/{len(self.cameras)}"
        threading.Thread(target=_do, daemon=True).start()

    def _shutdown(self):
        log.info("Shutting down…")
        if self.recording:
            self.stop_recording()
        for cam in self.cameras:
            cam.stop()
        cv2.destroyAllWindows()
        log.info("Goodbye.")


# ══════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def _print_banner():
    print(r"""
  ██████╗ ██████╗  ██████╗ ██╗██████╗  ██████╗ ██████╗ ██╗██████╗
  ██╔══██╗██╔══██╗██╔═══██╗██║██╔══██╗██╔════╝ ██╔══██╗██║██╔══██╗
  ██║  ██║██████╔╝██║   ██║██║██║  ██║██║  ███╗██████╔╝██║██║  ██║
  ██║  ██║██╔══██╗██║   ██║██║██║  ██║██║   ██║██╔══██╗██║██║  ██║
  ██████╔╝██║  ██║╚██████╔╝██║██████╔╝╚██████╔╝██║  ██║██║██████╔╝
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝
  Multi-Phone DroidCam Controller — github.com/luuucciiffeerr/droidgrid
""")


if __name__ == "__main__":
    _print_banner()

    app = DroidGrid()

    print("Connecting to cameras (parallel)…")
    app.connect_all()
    app.start_all()

    connected = sum(c.connected for c in app.cameras)
    if connected == 0:
        print("\n[!] No cameras connected.")
        print("    Check:\n"
              "      1. Phones are on the same Wi-Fi network\n"
              "      2. DroidCam app is open on each phone\n"
              "      3. IP addresses in CAMERAS list are correct\n"
              "      4. Firewall is not blocking port 4747\n")
        sys.exit(1)

    print(f"\n{connected}/{len(app.cameras)} cameras ready.\n")
    app.run()
