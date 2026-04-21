# DroidGrid

**Multi-phone DroidCam controller for your PC.**  
Preview, record and snapshot from up to 10 Android phones simultaneously — straight from a single Python script.

```
  ██████╗ ██████╗  ██████╗ ██╗██████╗  ██████╗ ██████╗ ██╗██████╗
  ██╔══██╗██╔══██╗██╔═══██╗██║██╔══██╗██╔════╝ ██╔══██╗██║██╔══██╗
  ██║  ██║██████╔╝██║   ██║██║██║  ██║██║  ███╗██████╔╝██║██║  ██║
  ██║  ██║██╔══██╗██║   ██║██║██║  ██║██║   ██║██╔══██╗██║██║  ██║
  ██████╔╝██║  ██║╚██████╔╝██║██████╔╝╚██████╔╝██║  ██║██║██████╔╝
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝
```

[![Python](https://img.shields.io/badge/python-3.8%2B-blue?logo=python)](https://python.org)
[![OpenCV](https://img.shields.io/badge/opencv-4.8%2B-green?logo=opencv)](https://opencv.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

---

## What it does

DroidGrid turns the free [DroidCam](https://www.dev47apps.com/) app into a proper multi-camera studio.  
Open DroidCam on several Android phones, run `droidgrid.py` on your PC, and you get:

| Feature | Detail |
|---|---|
| **Live grid preview** | Up to 10 phones in a tiled 3-column view |
| **Simultaneous recording** | Each camera saves its own `.mp4` file |
| **Instant snapshot** | One JPEG per camera with a single keypress |
| **Self-healing streams** | Frozen-frame detection + auto-reconnect |
| **Non-blocking I/O** | Dedicated write thread per camera — no dropped frames |
| **Inline editing** | Change label / person / repeat ID without leaving the window |
| **Custom naming** | Pattern with `{label}` `{person}` `{repeat}` `{camera}` `{date}` `{time}` |
| **HUD overlay** | Live FPS, frame count, drop counter, REC badge per cell |

---

## Requirements

- Python **3.8+**
- [DroidCam](https://www.dev47apps.com/) installed on each Android phone
- All devices on the **same Wi-Fi network**

```bash
pip install opencv-python numpy
```

---

## Quick start

### 1 — Install DroidCam on your phones

Download **DroidCam** from the Play Store (free). Open it — you'll see the phone's local IP address on screen.

### 2 — Edit the camera list

Open `droidgrid.py` and update the `CAMERAS` section at the top:

```python
CAMERAS = [
    {"name": "Phone-1", "ip": "192.168.1.101", "port": 4747, "res": (1280, 720), "fps": 30},
    {"name": "Phone-2", "ip": "192.168.1.102", "port": 4747, "res": (1280, 720), "fps": 30},
    # add as many as you need (tested up to 10)
]
```

> **Tip:** For 5+ cameras, drop `fps` to `20` and `res` to `(960, 540)` for smoother performance on mid-range hardware.

### 3 — Run

```bash
python droidgrid.py
```

A preview window opens automatically. All cameras try to connect in parallel.

---

## Keyboard controls

| Key | Action |
|-----|--------|
| `R` | Start recording — all connected cameras |
| `S` | Stop recording — files saved, repeat counter auto-advances |
| `T` | **Snapshot** — save one JPEG per camera right now |
| `G` | Set session Label (e.g. gesture name, activity) |
| `P` | Set Person ID |
| `N` | Set Repeat number |
| `C` | Reconnect all cameras |
| `H` | Toggle HUD overlay on / off |
| `Q` | Quit |

> All text input happens **inside the preview window** — no need to click the terminal.

---

## Output files

```
recordings/
└── session_p01_r01_Phone-1.mp4
└── session_p01_r01_Phone-2.mp4
└── ...

snapshots/
└── session_p01_r01_Phone-1_20250421_143022.jpg
└── ...
```

### Custom naming pattern

Edit `NAMING_PATTERN` in the script:

```python
NAMING_PATTERN = "{label}_{person}_{repeat}_{camera}"
```

Available tokens: `{label}` `{person}` `{repeat}` `{camera}` `{date}` `{time}`

---

## Architecture

```
Main thread (UI loop)
│
├── Camera-1 capture thread ──→ write queue ──→ Camera-1 writer thread → .mp4
├── Camera-2 capture thread ──→ write queue ──→ Camera-2 writer thread → .mp4
├── Camera-3 capture thread ──→ write queue ──→ Camera-3 writer thread → .mp4
└── ...
```

- Each camera runs its own **capture thread** (read + freeze-detect + reconnect).
- Frames are pushed to a **per-camera queue**; a dedicated **writer thread** drains it.
- The main thread only does UI rendering — it never blocks on I/O.

### Self-healing

DroidGrid detects two failure modes and reconnects automatically:

| Failure | Detection | Action |
|---------|-----------|--------|
| Stream drop | `cap.read()` returns `False` | Reconnect after 2 s |
| Frozen stream | MD5 hash same for 60+ frames | Reconnect immediately |

---

## Configuration reference

All settings are at the top of `droidgrid.py`:

```python
RECORD_DIR      = "recordings"   # where .mp4 files go
SNAPSHOT_DIR    = "snapshots"    # where .jpg snapshots go
NAMING_PATTERN  = "{label}_{person}_{repeat}_{camera}"
CELL_W          = 640            # preview cell width  (px)
CELL_H          = 360            # preview cell height (px)
CODEC           = "mp4v"         # video codec fourcc
FREEZE_THRESHOLD = 60            # frames before freeze reconnect
RECONNECT_DELAY  = 2.0           # seconds between reconnect attempts
```

---

## FAQ

**Q: How many phones can I use?**  
Tested up to 5 phones at 1080p/30fps on a single machine. 10 phones should work at lower resolutions.

**Q: DroidCam free vs paid?**  
The free version works. Paid removes the watermark and unlocks higher resolutions.

**Q: Can I use RTSP cameras instead of DroidCam?**  
Yes. Replace `"ip"` with the full URL and remove `"port"`:
```python
{"name": "IPCam", "ip": "rtsp://192.168.1.200:554/stream", "port": None, "res": (1920,1080), "fps":25}
```
Then update the `url` property in the `Camera` class to return `self.ip` directly when `port` is `None`.

**Q: The stream is laggy / dropping frames.**  
Lower `fps` and `res` in `CAMERAS`. Also make sure phones and PC are on **5 GHz Wi-Fi** rather than 2.4 GHz.

**Q: Files aren't being saved.**  
Check that `recordings/` is writable. On Windows, avoid paths with spaces.

---

## Contributing

Pull requests are welcome. For major changes, open an issue first.

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m "Add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

[MIT](LICENSE) — free for personal and commercial use.

---

*Built with OpenCV. Inspired by the need to record multi-angle video datasets without expensive camera rigs.*
