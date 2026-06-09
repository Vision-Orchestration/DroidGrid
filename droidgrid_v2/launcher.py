#!/usr/bin/env python3
"""
DroidGrid Launcher
==================
Graphical configuration window that runs before the camera grid.
Manages camera IPs, profiles, and session settings — no code editing needed.

Entry point:  python launcher.py
"""

import tkinter as tk
from tkinter import ttk, messagebox, simpledialog, filedialog
import json
import os
import threading
import socket
import urllib.request
from pathlib import Path
from typing import Optional

# ── where to persist profiles ──────────────────────────────────────────────
CONFIG_DIR  = Path.home() / ".droidgrid"
PROFILES_FILE = CONFIG_DIR / "profiles.json"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# ── default values ──────────────────────────────────────────────────────────
DEFAULT_PORT       = 4747
DEFAULT_RES        = "1280x720"
DEFAULT_FPS        = 30
DEFAULT_PATTERN    = "{label}_{person}_{repeat}_{camera}"
DEFAULT_RECORD_DIR = "recordings"
DEFAULT_SNAP_DIR   = "snapshots"

RESOLUTIONS = ["1920x1080", "1280x720", "960x540", "640x480", "320x240"]
FPS_OPTIONS = [10, 15, 20, 24, 25, 30]

# ── colour palette (minimal TUI design system) ──────────────────────────────
# Inspired by awesome-tui-designDESIGN.md — Vercel/Linear terminal aesthetics.
BG       = "#0a0a0a"      # main background  (ANSI 232)
BG2      = "#1a1a1a"      # card background  (surface)
BG3      = "#2a2a2a"      # input background (neutral 100)
BORDER   = "#2a2a2a"      # subtle border    (neutral 100)
ACCENT   = "#0070f3"      # blue accent      (primary)
ACCENT2  = "#0060d0"      # blue accent hover
SUCCESS  = "#00c853"      # green  (success)
WARN     = "#f5a623"      # amber  (warning)
DANGER   = "#ee0000"      # red    (error)
FG       = "#ededed"      # primary text     (ANSI 255)
FG2      = "#888888"      # secondary text   (neutral 400)
FG3      = "#555555"      # muted text       (neutral 200)

FONT_TITLE  = ("Segoe UI", 22, "bold")
FONT_HEAD   = ("Segoe UI", 11, "bold")
FONT_BODY   = ("Segoe UI", 10)
FONT_SMALL  = ("Segoe UI", 9)
FONT_MONO   = ("Consolas", 10)

# ════════════════════════════════════════════════════════════════════════════
#  PROFILE STORE
# ════════════════════════════════════════════════════════════════════════════

class ProfileStore:
    """Load/save named camera profiles from ~/.droidgrid/profiles.json."""

    def __init__(self):
        self.data: dict = {"profiles": {}, "last_used": None, "settings": {}}
        self._load()

    def _load(self):
        if PROFILES_FILE.exists():
            try:
                self.data = json.loads(PROFILES_FILE.read_text())
            except Exception:
                pass

    def save(self):
        PROFILES_FILE.write_text(json.dumps(self.data, indent=2))

    def profile_names(self) -> list:
        return sorted(self.data.get("profiles", {}).keys())

    def get_profile(self, name: str) -> Optional[dict]:
        return self.data["profiles"].get(name)

    def save_profile(self, name: str, cameras: list, session: dict):
        self.data.setdefault("profiles", {})[name] = {
            "cameras": cameras,
            "session": session,
        }
        self.data["last_used"] = name
        self.save()

    def delete_profile(self, name: str):
        self.data.get("profiles", {}).pop(name, None)
        if self.data.get("last_used") == name:
            self.data["last_used"] = None
        self.save()

    def save_settings(self, settings: dict):
        self.data["settings"] = settings
        self.save()

    def get_settings(self) -> dict:
        return self.data.get("settings", {})

    def get_last_profile(self) -> Optional[str]:
        return self.data.get("last_used")


# ════════════════════════════════════════════════════════════════════════════
#  CAMERA ROW WIDGET
# ════════════════════════════════════════════════════════════════════════════

class CameraRow:
    """One camera entry: checkbox, name, IP, port, resolution, fps, test."""

    def __init__(self, parent_frame, row_idx: int, remove_cb, on_change_cb,
                 data: dict = None):
        self.frame      = tk.Frame(parent_frame, bg=BG2, pady=4)
        self.remove_cb  = remove_cb
        self.on_change  = on_change_cb
        self._test_th: Optional[threading.Thread] = None

        # ── variables ──────────────────────────────────────────────────────
        d = data or {}
        self.enabled_var = tk.BooleanVar(value=d.get("enabled", True))
        self.name_var    = tk.StringVar(value=d.get("name",  f"Phone-{row_idx+1}"))
        self.ip_var      = tk.StringVar(value=d.get("ip",    ""))
        self.port_var    = tk.StringVar(value=str(d.get("port", DEFAULT_PORT)))
        res = d.get("res", [1280, 720])
        self.res_var     = tk.StringVar(value=f"{res[0]}x{res[1]}")
        self.fps_var     = tk.IntVar(value=d.get("fps", DEFAULT_FPS))
        self._status_var = tk.StringVar(value="")

        self._build()

    def _build(self):
        f = self.frame

        # drag handle / row number label
        tk.Label(f, text="⠿", bg=BG2, fg=FG3,
                 font=("Segoe UI", 14)).pack(side=tk.LEFT, padx=(6, 2))

        # checkbox
        cb = tk.Checkbutton(f, variable=self.enabled_var, bg=BG2,
                            activebackground=BG2,
                            selectcolor=ACCENT, fg=FG,
                            command=self.on_change)
        cb.pack(side=tk.LEFT, padx=(0, 4))

        # name
        self._entry(f, self.name_var, width=12, placeholder="Name")

        # IP address
        ip_e = self._entry(f, self.ip_var, width=16, placeholder="192.168.x.x",
                           font=FONT_MONO)

        # port
        tk.Label(f, text=":", bg=BG2, fg=FG2, font=FONT_BODY).pack(side=tk.LEFT)
        self._entry(f, self.port_var, width=6, font=FONT_MONO)

        # resolution dropdown
        res_cb = ttk.Combobox(f, textvariable=self.res_var,
                              values=RESOLUTIONS, width=11,
                              font=FONT_BODY, state="readonly")
        res_cb.pack(side=tk.LEFT, padx=4)
        res_cb.bind("<<ComboboxSelected>>", lambda e: self.on_change())

        # fps
        tk.Label(f, text="fps:", bg=BG2, fg=FG2,
                 font=FONT_SMALL).pack(side=tk.LEFT, padx=(4, 1))
        fps_spin = tk.Spinbox(f, textvariable=self.fps_var,
                              values=FPS_OPTIONS, width=4,
                              bg=BG3, fg=FG, insertbackground=FG,
                              relief=tk.FLAT, font=FONT_BODY,
                              command=self.on_change)
        fps_spin.pack(side=tk.LEFT, padx=(0, 6))

        # test button
        self._test_btn = tk.Button(f, text="Test", width=5,
                                   bg=BG3, fg=ACCENT,
                                   activebackground=BORDER,
                                   activeforeground=FG,
                                   relief=tk.FLAT, cursor="hand2",
                                   font=FONT_SMALL,
                                   command=self._test_connection)
        self._test_btn.pack(side=tk.LEFT, padx=2)

        # status indicator
        self._status_lbl = tk.Label(f, textvariable=self._status_var,
                                    bg=BG2, fg=FG3, font=FONT_SMALL, width=10)
        self._status_lbl.pack(side=tk.LEFT, padx=4)

        # remove button
        tk.Button(f, text="✕", width=3,
                  bg=BG2, fg=FG3,
                  activebackground=DANGER, activeforeground=FG,
                  relief=tk.FLAT, cursor="hand2",
                  font=FONT_SMALL,
                  command=self.remove_cb).pack(side=tk.RIGHT, padx=(0, 6))

    def _entry(self, parent, var, width=14, placeholder="", font=FONT_BODY):
        e = tk.Entry(parent, textvariable=var, width=width,
                     bg=BG3, fg=FG, insertbackground=FG,
                     relief=tk.FLAT, font=font,
                     highlightthickness=1,
                     highlightcolor=ACCENT,
                     highlightbackground=BORDER)
        e.pack(side=tk.LEFT, padx=3, ipady=4)
        e.bind("<KeyRelease>", lambda ev: self.on_change())
        return e

    def _test_connection(self):
        if self._test_th and self._test_th.is_alive():
            return
        self._test_btn.config(state=tk.DISABLED)
        self._status_var.set("testing…")
        self._status_lbl.config(fg=WARN)
        self._test_th = threading.Thread(target=self._do_test, daemon=True)
        self._test_th.start()

    def _do_test(self):
        ip   = self.ip_var.get().strip()
        port = self.port_var.get().strip()
        ok   = False
        try:
            url = f"http://{ip}:{port}/mjpegfeed"
            req = urllib.request.urlopen(url, timeout=3)
            ok = req.status == 200
            req.close()
        except Exception:
            # fallback: TCP connect
            try:
                s = socket.create_connection((ip, int(port)), timeout=3)
                s.close()
                ok = True
            except Exception:
                ok = False
        # update UI from main thread
        self.frame.after(0, self._test_result, ok)

    def _test_result(self, ok: bool):
        if ok:
            self._status_var.set("✓ online")
            self._status_lbl.config(fg=SUCCESS)
        else:
            self._status_var.set("✗ offline")
            self._status_lbl.config(fg=DANGER)
        self._test_btn.config(state=tk.NORMAL)

    def to_dict(self) -> dict:
        res_str = self.res_var.get()
        try:
            w, h = map(int, res_str.split("x"))
        except Exception:
            w, h = 1280, 720
        try:
            port = int(self.port_var.get())
        except Exception:
            port = DEFAULT_PORT
        return {
            "name":    self.name_var.get().strip() or "Camera",
            "ip":      self.ip_var.get().strip(),
            "port":    port,
            "res":     [w, h],
            "fps":     self.fps_var.get(),
            "enabled": self.enabled_var.get(),
        }

    def destroy(self):
        self.frame.destroy()


# ════════════════════════════════════════════════════════════════════════════
#  MAIN LAUNCHER WINDOW
# ════════════════════════════════════════════════════════════════════════════

class DroidGridLauncher:

    def __init__(self):
        self.store   = ProfileStore()
        self.rows: list[CameraRow] = []
        self._launched = False
        self._launch_config: Optional[dict] = None

        self.root = tk.Tk()
        self._setup_window()
        self._apply_theme()
        self._build_ui()
        self._load_last_state()

    # ── window setup ────────────────────────────────────────────────────────

    def _setup_window(self):
        self.root.title("DroidGrid")
        self.root.configure(bg=BG)
        self.root.resizable(True, True)
        self.root.minsize(900, 640)
        # centre on screen
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        w, h = 980, 720
        x = (sw - w) // 2
        y = (sh - h) // 2
        self.root.geometry(f"{w}x{h}+{x}+{y}")
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _apply_theme(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(".",
            background=BG, foreground=FG,
            fieldbackground=BG3, troughcolor=BG2,
            selectbackground=ACCENT, selectforeground=FG,
            bordercolor=BORDER, darkcolor=BG2, lightcolor=BG2,
            font=FONT_BODY)
        style.configure("TCombobox",
            background=BG3, foreground=FG,
            fieldbackground=BG3, arrowcolor=FG2,
            bordercolor=BORDER)
        style.map("TCombobox",
            fieldbackground=[("readonly", BG3)],
            background=[("readonly", BG3)])
        style.configure("Vertical.TScrollbar",
            background=BG2, troughcolor=BG,
            arrowcolor=FG3, bordercolor=BG)
        style.configure("TNotebook",
            background=BG, tabmargins=[0, 0, 0, 0])
        style.configure("TNotebook.Tab",
            background=BG2, foreground=FG2,
            padding=[16, 8], font=FONT_BODY)
        style.map("TNotebook.Tab",
            background=[("selected", BG3)],
            foreground=[("selected", FG)])

    # ── UI construction ──────────────────────────────────────────────────────

    def _build_ui(self):
        root = self.root

        # ── header ──────────────────────────────────────────────────────────
        hdr = tk.Frame(root, bg=BG2, pady=0)
        hdr.pack(fill=tk.X)

        # accent line top
        tk.Frame(hdr, bg=ACCENT, height=2).pack(fill=tk.X)

        hdr_inner = tk.Frame(hdr, bg=BG2, padx=24, pady=14)
        hdr_inner.pack(fill=tk.X)

        # logo + title
        logo_frame = tk.Frame(hdr_inner, bg=BG2)
        logo_frame.pack(side=tk.LEFT)

        tk.Label(logo_frame, text="⬡", bg=BG2, fg=ACCENT,
                 font=("Segoe UI", 28)).pack(side=tk.LEFT, padx=(0, 10))

        title_frame = tk.Frame(logo_frame, bg=BG2)
        title_frame.pack(side=tk.LEFT)
        tk.Label(title_frame, text="DroidGrid",
                 bg=BG2, fg=FG, font=FONT_TITLE).pack(anchor=tk.W)
        tk.Label(title_frame,
                 text="Multi-phone DroidCam Controller",
                 bg=BG2, fg=FG2, font=FONT_SMALL).pack(anchor=tk.W)

        # launch button (top-right)
        self._launch_btn = tk.Button(
            hdr_inner,
            text="  ▶  Launch  ",
            bg=ACCENT, fg="#ffffff",
            activebackground=ACCENT2, activeforeground="#ffffff",
            relief=tk.FLAT, cursor="hand2",
            font=("Segoe UI", 11, "bold"),
            padx=18, pady=8,
            command=self._launch)
        self._launch_btn.pack(side=tk.RIGHT)

        # connected count badge
        self._badge_var = tk.StringVar(value="")
        tk.Label(hdr_inner, textvariable=self._badge_var,
                 bg=BG2, fg=FG2, font=FONT_SMALL).pack(side=tk.RIGHT, padx=16)

        # separator
        tk.Frame(root, bg=BORDER, height=1).pack(fill=tk.X)

        # ── main body ────────────────────────────────────────────────────────
        body = tk.Frame(root, bg=BG)
        body.pack(fill=tk.BOTH, expand=True)

        # left column: cameras + session
        left = tk.Frame(body, bg=BG)
        left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=0)

        # right column: profiles + settings
        right = tk.Frame(body, bg=BG2, width=240)
        right.pack(side=tk.RIGHT, fill=tk.Y)
        right.pack_propagate(False)

        self._build_cameras_section(left)
        self._build_session_section(left)
        self._build_right_panel(right)

        # ── status bar ───────────────────────────────────────────────────────
        tk.Frame(root, bg=BORDER, height=1).pack(fill=tk.X)
        sb = tk.Frame(root, bg=BG2, pady=5)
        sb.pack(fill=tk.X)
        self._statusbar_var = tk.StringVar(
            value="Configure cameras, select a profile, then click Launch.")
        tk.Label(sb, textvariable=self._statusbar_var,
                 bg=BG2, fg=FG3, font=FONT_SMALL,
                 anchor=tk.W).pack(side=tk.LEFT, padx=14)
        tk.Label(sb, text="Vision-Orchestration / DroidGrid",
                 bg=BG2, fg=FG3, font=FONT_SMALL).pack(side=tk.RIGHT, padx=14)

    # ── cameras section ──────────────────────────────────────────────────────

    def _build_cameras_section(self, parent):
        sec = tk.Frame(parent, bg=BG)
        sec.pack(fill=tk.BOTH, expand=True, padx=16, pady=(14, 0))

        # section header
        hdr = tk.Frame(sec, bg=BG)
        hdr.pack(fill=tk.X, pady=(0, 8))
        tk.Label(hdr, text="📷  Cameras",
                 bg=BG, fg=FG, font=FONT_HEAD).pack(side=tk.LEFT)

        btn_frame = tk.Frame(hdr, bg=BG)
        btn_frame.pack(side=tk.RIGHT)

        tk.Button(btn_frame, text="＋ Add Camera",
                  bg=BG3, fg=ACCENT,
                  activebackground=BORDER, activeforeground=FG,
                  relief=tk.FLAT, cursor="hand2",
                  font=FONT_SMALL, padx=8, pady=3,
                  command=self._add_row).pack(side=tk.LEFT, padx=4)

        tk.Button(btn_frame, text="⚡ Test All",
                  bg=BG3, fg=WARN,
                  activebackground=BORDER, activeforeground=FG,
                  relief=tk.FLAT, cursor="hand2",
                  font=FONT_SMALL, padx=8, pady=3,
                  command=self._test_all).pack(side=tk.LEFT)

        # column headers
        col_hdr = tk.Frame(sec, bg=BG)
        col_hdr.pack(fill=tk.X, pady=(0, 4))
        labels = [
            ("  ", 4), ("En", 3), ("Name", 12),
            ("IP Address", 18), ("Port", 7),
            ("Resolution", 13), ("FPS", 6), ("", 6),
        ]
        for text, w in labels:
            tk.Label(col_hdr, text=text, bg=BG, fg=FG3,
                     font=FONT_SMALL, width=w,
                     anchor=tk.W).pack(side=tk.LEFT)

        tk.Frame(sec, bg=BORDER, height=1).pack(fill=tk.X, pady=(0, 6))

        # scrollable camera list
        container = tk.Frame(sec, bg=BG)
        container.pack(fill=tk.BOTH, expand=True)

        canvas = tk.Canvas(container, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(container, orient=tk.VERTICAL,
                                  command=canvas.yview)
        self._cam_frame = tk.Frame(canvas, bg=BG)

        self._cam_frame.bind("<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self._cam_frame, anchor=tk.NW)
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # mousewheel
        def _on_wheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        canvas.bind_all("<MouseWheel>", _on_wheel)

    def _add_row(self, data: dict = None):
        idx = len(self.rows)
        row = CameraRow(
            self._cam_frame, idx,
            remove_cb=lambda r=None: self._remove_row(len(self.rows) - 1 if r is None else r),
            on_change_cb=self._on_cameras_changed,
            data=data,
        )
        # fix remove to use correct index
        row.remove_cb = lambda: self._remove_row_obj(row)
        row.frame.pack(fill=tk.X, pady=2, padx=2)
        self.rows.append(row)
        self._update_badge()

    def _remove_row_obj(self, row: CameraRow):
        if row in self.rows:
            self.rows.remove(row)
            row.destroy()
            self._update_badge()
            self._on_cameras_changed()

    def _test_all(self):
        for row in self.rows:
            if row.enabled_var.get():
                row._test_connection()

    def _on_cameras_changed(self):
        n = sum(1 for r in self.rows if r.enabled_var.get() and r.ip_var.get().strip())
        self._update_badge(n)

    def _update_badge(self, n: int = None):
        if n is None:
            n = sum(1 for r in self.rows if r.enabled_var.get() and r.ip_var.get().strip())
        total = len(self.rows)
        self._badge_var.set(f"{n} / {total} cameras enabled")

    # ── session section ──────────────────────────────────────────────────────

    def _build_session_section(self, parent):
        sec = tk.Frame(parent, bg=BG2, padx=16, pady=12)
        sec.pack(fill=tk.X, padx=16, pady=(10, 14))

        tk.Label(sec, text="🏷️  Session & Output",
                 bg=BG2, fg=FG, font=FONT_HEAD).grid(
                     row=0, column=0, columnspan=6, sticky=tk.W, pady=(0, 10))

        fields = [
            ("Label",   "session_label",   "heeltap",                 10),
            ("Person",  "session_person",  "p01",                     8),
            ("Repeat",  "session_repeat",  "r01",                     8),
        ]
        self._sess_vars: dict[str, tk.StringVar] = {}
        for col, (label, key, default, width) in enumerate(fields):
            tk.Label(sec, text=label, bg=BG2, fg=FG2,
                     font=FONT_SMALL).grid(row=1, column=col*2, sticky=tk.W, padx=(0 if col==0 else 12, 2))
            var = tk.StringVar(value=default)
            self._sess_vars[key] = var
            tk.Entry(sec, textvariable=var, width=width,
                     bg=BG3, fg=FG, insertbackground=FG,
                     relief=tk.FLAT, font=FONT_MONO,
                     highlightthickness=1,
                     highlightcolor=ACCENT,
                     highlightbackground=BORDER).grid(
                         row=1, column=col*2+1, padx=(0, 4), ipady=4)

        # naming pattern + dirs on next row
        tk.Label(sec, text="Pattern", bg=BG2, fg=FG2,
                 font=FONT_SMALL).grid(row=2, column=0, sticky=tk.W, pady=(8, 0))
        self._sess_vars["pattern"] = tk.StringVar(value=DEFAULT_PATTERN)
        tk.Entry(sec, textvariable=self._sess_vars["pattern"], width=36,
                 bg=BG3, fg=ACCENT, insertbackground=FG,
                 relief=tk.FLAT, font=FONT_MONO,
                 highlightthickness=1,
                 highlightcolor=ACCENT,
                 highlightbackground=BORDER).grid(
                     row=2, column=1, columnspan=3, sticky=tk.W,
                     padx=(0, 12), pady=(8, 0), ipady=4)
        tk.Label(sec, text="{label} {person} {repeat} {camera} {date} {time}",
                 bg=BG2, fg=FG3, font=FONT_SMALL).grid(
                     row=2, column=4, columnspan=2, sticky=tk.W, pady=(8, 0))

        # output dirs
        tk.Label(sec, text="Recordings", bg=BG2, fg=FG2,
                 font=FONT_SMALL).grid(row=3, column=0, sticky=tk.W, pady=(6, 0))
        self._sess_vars["record_dir"] = tk.StringVar(value=DEFAULT_RECORD_DIR)
        rec_e = tk.Entry(sec, textvariable=self._sess_vars["record_dir"], width=20,
                         bg=BG3, fg=FG, insertbackground=FG,
                         relief=tk.FLAT, font=FONT_MONO,
                         highlightthickness=1, highlightcolor=ACCENT,
                         highlightbackground=BORDER)
        rec_e.grid(row=3, column=1, columnspan=2, sticky=tk.W,
                   padx=(0, 4), pady=(6, 0), ipady=4)
        tk.Button(sec, text="Browse", bg=BG3, fg=FG2,
                  activebackground=BORDER, relief=tk.FLAT,
                  font=FONT_SMALL, cursor="hand2",
                  command=lambda: self._browse_dir(self._sess_vars["record_dir"])
                  ).grid(row=3, column=3, pady=(6, 0), padx=(0, 16), sticky=tk.W)

        tk.Label(sec, text="Snapshots", bg=BG2, fg=FG2,
                 font=FONT_SMALL).grid(row=3, column=4, sticky=tk.W, pady=(6, 0), padx=(12, 2))
        self._sess_vars["snap_dir"] = tk.StringVar(value=DEFAULT_SNAP_DIR)
        tk.Entry(sec, textvariable=self._sess_vars["snap_dir"], width=20,
                 bg=BG3, fg=FG, insertbackground=FG,
                 relief=tk.FLAT, font=FONT_MONO,
                 highlightthickness=1, highlightcolor=ACCENT,
                 highlightbackground=BORDER).grid(
                     row=3, column=5, padx=(0, 4), pady=(6, 0), ipady=4)

    def _browse_dir(self, var: tk.StringVar):
        path = filedialog.askdirectory(title="Select output directory")
        if path:
            var.set(path)

    # ── profiles panel ───────────────────────────────────────────────────────

    def _build_right_panel(self, parent):
        tk.Frame(parent, bg=BORDER, width=1).pack(side=tk.LEFT, fill=tk.Y)

        notebook = ttk.Notebook(parent)
        notebook.pack(fill=tk.BOTH, expand=True)

        # ── Tab 1: Profiles ──────────────────────────────────────────────────
        tab_profiles = tk.Frame(notebook, bg=BG2, padx=14)
        notebook.add(tab_profiles, text="  Profiles  ")

        tk.Label(tab_profiles, text="📁  Profiles",
                 bg=BG2, fg=FG, font=FONT_HEAD).pack(anchor=tk.W, pady=(12, 8))

        lb_frame = tk.Frame(tab_profiles, bg=BG2)
        lb_frame.pack(fill=tk.BOTH, expand=True)

        sb = ttk.Scrollbar(lb_frame, orient=tk.VERTICAL)
        self._profile_lb = tk.Listbox(
            lb_frame, bg=BG3, fg=FG,
            selectbackground=ACCENT, selectforeground="#fff",
            relief=tk.FLAT, font=FONT_BODY,
            activestyle=tk.NONE,
            yscrollcommand=sb.set,
            highlightthickness=1, highlightcolor=BORDER,
            highlightbackground=BORDER,
        )
        sb.config(command=self._profile_lb.yview)
        self._profile_lb.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self._profile_lb.bind("<<ListboxSelect>>", self._on_profile_select)
        self._profile_lb.bind("<Double-Button-1>", lambda e: self._load_profile())

        btn_cfg = {"bg": BG3, "fg": FG, "activebackground": BORDER,
                   "activeforeground": FG, "relief": tk.FLAT,
                   "cursor": "hand2", "font": FONT_SMALL}
        btn_row1 = tk.Frame(tab_profiles, bg=BG2)
        btn_row1.pack(fill=tk.X, pady=(6, 0))
        tk.Button(btn_row1, text="Load", **btn_cfg,
                  command=self._load_profile).pack(side=tk.LEFT, fill=tk.X,
                                                    expand=True, padx=(0, 2), ipady=3)
        tk.Button(btn_row1, text="Save As…", **btn_cfg,
                  command=self._save_profile).pack(side=tk.LEFT, fill=tk.X,
                                                    expand=True, padx=(2, 0), ipady=3)
        btn_row2 = tk.Frame(tab_profiles, bg=BG2)
        btn_row2.pack(fill=tk.X, pady=(3, 0))
        tk.Button(btn_row2, text="Rename…", **btn_cfg,
                  command=self._rename_profile).pack(side=tk.LEFT, fill=tk.X,
                                                      expand=True, padx=(0, 2), ipady=3)
        tk.Button(btn_row2, text="Delete", bg=BG3, fg=DANGER,
                  activebackground=BORDER, activeforeground=DANGER,
                  relief=tk.FLAT, cursor="hand2", font=FONT_SMALL,
                  command=self._delete_profile).pack(side=tk.LEFT, fill=tk.X,
                                                      expand=True, padx=(2, 0), ipady=3)
        tk.Button(tab_profiles, text="💾  Quick Save", bg=BG3, fg=ACCENT,
                  activebackground=BORDER, activeforeground=ACCENT,
                  relief=tk.FLAT, cursor="hand2", font=FONT_SMALL,
                  command=self._quick_save).pack(fill=tk.X, pady=(6, 0), ipady=4)

        self._refresh_profile_list()

        # ── Tab 2: Addons ────────────────────────────────────────────────────
        tab_addons = tk.Frame(notebook, bg=BG2, padx=14)
        notebook.add(tab_addons, text="  Addons  ")
        self._build_addons_panel(tab_addons)

    def _build_addons_panel(self, parent):
        tk.Label(parent, text="🧩  Addons",
                 bg=BG2, fg=FG, font=FONT_HEAD).pack(anchor=tk.W, pady=(12, 8))

        # scan addons directory
        addons_root = Path(__file__).resolve().parent.parent / "addons"
        found = []
        if addons_root.exists():
            for d in sorted(addons_root.iterdir()):
                if d.is_dir():
                    manifest_path = d / "addon.json"
                    if manifest_path.exists():
                        try:
                            manifest = json.loads(manifest_path.read_text())
                            found.append(manifest)
                        except Exception:
                            found.append({"id": d.name, "name": d.name,
                                          "version": "?", "description": "Invalid manifest"})

        if not found:
            tk.Label(parent, text="No addons found", bg=BG2, fg=FG3,
                     font=FONT_SMALL).pack(anchor=tk.W, pady=10)
            tk.Label(parent, text="Add addon directories to:", bg=BG2,
                     fg=FG3, font=FONT_SMALL).pack(anchor=tk.W)
            tk.Label(parent, text=str(addons_root), bg=BG2,
                     fg=ACCENT, font=FONT_SMALL).pack(anchor=tk.W)
            return

        # addon list
        lb_frame = tk.Frame(parent, bg=BG2)
        lb_frame.pack(fill=tk.BOTH, expand=True)

        self._addon_lb = tk.Listbox(
            lb_frame, bg=BG3, fg=FG,
            selectbackground=ACCENT, selectforeground="#fff",
            relief=tk.FLAT, font=FONT_BODY,
            activestyle=tk.NONE,
            highlightthickness=1, highlightcolor=BORDER,
            highlightbackground=BORDER,
        )
        self._addon_lb.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self._addon_data = found
        for a in found:
            desc = a.get("description", "")[:40]
            label = f"  {a['name']}  v{a.get('version','?')}"
            self._addon_lb.insert(tk.END, label)

        # addon detail area
        self._addon_detail_var = tk.StringVar(value="Select an addon for details")
        tk.Label(parent, textvariable=self._addon_detail_var,
                 bg=BG2, fg=FG2, font=FONT_SMALL,
                 wraplength=200, justify=tk.LEFT, anchor=tk.W).pack(
                     anchor=tk.W, fill=tk.X, pady=(6, 0))

        self._addon_lb.bind("<<ListboxSelect>>", self._on_addon_select)

        # footer
        tk.Frame(parent, bg=BORDER, height=1).pack(fill=tk.X, pady=8)

        help_lines = [
            "Addons extend DroidGrid with",
            "custom capabilities.",
            "Manage addons in the Pro",
            "web UI (Extensions tab).",
        ]
        for line in help_lines:
            tk.Label(parent, text=line, bg=BG2,
                     fg=FG3, font=FONT_SMALL,
                     anchor=tk.W).pack(anchor=tk.W)

    def _on_addon_select(self, event=None):
        sel = self._addon_lb.curselection()
        if not sel:
            return
        idx = sel[0]
        if idx < len(self._addon_data):
            a = self._addon_data[idx]
            desc = a.get("description", "No description available.")
            lines = [f"Name: {a['name']}",
                     f"ID:   {a.get('id', '?')}",
                     f"Ver:  {a.get('version', '?')}",
                     f"Auth: {a.get('author', '?')}",
                     f"",
                     f"{desc}"]
            self._addon_detail_var.set("\n".join(lines))

    def _refresh_profile_list(self):
        self._profile_lb.delete(0, tk.END)
        for name in self.store.profile_names():
            self._profile_lb.insert(tk.END, f"  {name}")

    def _get_selected_profile_name(self) -> Optional[str]:
        sel = self._profile_lb.curselection()
        if not sel:
            return None
        return self._profile_lb.get(sel[0]).strip()

    def _on_profile_select(self, event=None):
        name = self._get_selected_profile_name()
        if name:
            self._statusbar_var.set(f"Profile selected: {name}  —  double-click or press Load to apply")

    def _load_profile(self):
        name = self._get_selected_profile_name()
        if not name:
            messagebox.showinfo("Select Profile", "Select a profile from the list first.")
            return
        profile = self.store.get_profile(name)
        if not profile:
            return
        # clear existing rows
        for row in list(self.rows):
            row.destroy()
        self.rows.clear()
        # add rows from profile
        for cam_data in profile.get("cameras", []):
            self._add_row(cam_data)
        # restore session
        sess = profile.get("session", {})
        for key, var in self._sess_vars.items():
            if key in sess:
                var.set(sess[key])
        self._statusbar_var.set(f"Profile loaded: {name}")
        self._update_badge()

    def _save_profile(self):
        name = simpledialog.askstring(
            "Save Profile", "Profile name:",
            initialvalue=self._get_selected_profile_name() or "My Setup",
            parent=self.root)
        if not name:
            return
        self._do_save_profile(name.strip())

    def _quick_save(self):
        name = self._get_selected_profile_name()
        if not name:
            self._save_profile()
            return
        self._do_save_profile(name)

    def _do_save_profile(self, name: str):
        cams = [r.to_dict() for r in self.rows]
        sess = {k: v.get() for k, v in self._sess_vars.items()}
        self.store.save_profile(name, cams, sess)
        self._refresh_profile_list()
        # select the saved profile
        for i, n in enumerate(self.store.profile_names()):
            if n == name:
                self._profile_lb.selection_clear(0, tk.END)
                self._profile_lb.selection_set(i)
                self._profile_lb.see(i)
                break
        self._statusbar_var.set(f"Profile saved: {name}")

    def _rename_profile(self):
        old = self._get_selected_profile_name()
        if not old:
            return
        new = simpledialog.askstring("Rename Profile", "New name:",
                                      initialvalue=old, parent=self.root)
        if not new or new.strip() == old:
            return
        new = new.strip()
        profile = self.store.get_profile(old)
        if profile:
            self.store.save_profile(new, profile["cameras"], profile.get("session", {}))
            self.store.delete_profile(old)
        self._refresh_profile_list()

    def _delete_profile(self):
        name = self._get_selected_profile_name()
        if not name:
            return
        if messagebox.askyesno("Delete Profile",
                                f"Delete profile '{name}'?\nThis cannot be undone.",
                                parent=self.root):
            self.store.delete_profile(name)
            self._refresh_profile_list()
            self._statusbar_var.set(f"Profile deleted: {name}")

    # ── state persistence ────────────────────────────────────────────────────

    def _load_last_state(self):
        # Load last used profile
        last = self.store.get_last_profile()
        if last and self.store.get_profile(last):
            # select in list
            for i, name in enumerate(self.store.profile_names()):
                if name == last:
                    self._profile_lb.selection_set(i)
                    break
            self._load_profile()
        else:
            # add 3 empty camera rows to get started
            for i in range(3):
                self._add_row()

        # restore settings
        settings = self.store.get_settings()
        for key, var in self._sess_vars.items():
            if key in settings:
                var.set(settings[key])

    def _save_current_state(self):
        settings = {k: v.get() for k, v in self._sess_vars.items()}
        self.store.save_settings(settings)

    # ── launch ───────────────────────────────────────────────────────────────

    def _launch(self):
        cameras = [r.to_dict() for r in self.rows
                   if r.enabled_var.get() and r.ip_var.get().strip()]
        if not cameras:
            messagebox.showwarning(
                "No Cameras",
                "Please add at least one camera with an IP address\n"
                "and make sure the checkbox is enabled.",
                parent=self.root)
            return

        self._launch_config = {
            "cameras": cameras,
            "session": {k: v.get() for k, v in self._sess_vars.items()},
        }
        self._save_current_state()
        self._launched = True
        self.root.destroy()

    def _on_close(self):
        self._save_current_state()
        self.root.destroy()

    # ── run ──────────────────────────────────────────────────────────────────

    def run(self) -> Optional[dict]:
        """Show the launcher. Returns config dict if user clicked Launch, None otherwise."""
        self.root.mainloop()
        if self._launched:
            return self._launch_config
        return None


# ════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    launcher = DroidGridLauncher()
    config = launcher.run()

    if config is None:
        # User closed the launcher without clicking Launch
        import sys
        sys.exit(0)

    # Convert config to the format droidgrid.py expects
    from droidgrid import DroidGrid, CAMERAS as _default_cams

    # Build camera list from launcher config
    cameras_cfg = []
    for c in config["cameras"]:
        cameras_cfg.append({
            "name": c["name"],
            "ip":   c["ip"],
            "port": c["port"],
            "res":  tuple(c["res"]),
            "fps":  c["fps"],
        })

    sess = config["session"]

    # Launch the grid
    app = DroidGrid(
        cameras_cfg   = cameras_cfg,
        record_dir    = sess.get("record_dir", "recordings"),
        snapshot_dir  = sess.get("snap_dir",   "snapshots"),
        naming_pattern= sess.get("pattern",    "{label}_{person}_{repeat}_{camera}"),
        initial_label = sess.get("session_label", "session"),
        initial_person= sess.get("session_person", "p01"),
        initial_repeat= sess.get("session_repeat", "r01"),
    )

    print(f"\n{len(cameras_cfg)} camera(s) configured. Connecting…\n")
    app.connect_all()
    app.start_all()

    connected = sum(c.connected for c in app.cameras)
    print(f"{connected}/{len(app.cameras)} camera(s) ready.\n")

    app.run()
