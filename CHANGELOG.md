# Changelog

All notable changes to DroidGrid are documented here.
Format: [Semantic Versioning](https://semver.org)

---

## [1.0.0] — 2025-04-21

### Added
- Multi-phone MJPEG stream viewer (up to 10 cameras)
- Per-camera self-healing reconnect with freeze detection (MD5 hash)
- Non-blocking write queue per camera (separate writer thread)
- Video recording to `.mp4` with configurable codec, resolution, fps
- **Snapshot (T key)** — save one JPEG per camera instantly
- Inline prompt overlay — change Label / Person / Repeat without leaving the window
- HUD toggle (H key) — live fps, frame counter, drop counter, REC badge
- Auto-increment repeat counter after each Stop
- Naming pattern with `{label}`, `{person}`, `{repeat}`, `{camera}`, `{date}`, `{time}` tokens
- Safe path generation — never overwrites existing files
- Structured logging with timestamps
- MIT license
