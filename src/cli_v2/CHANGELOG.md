# Changelog

## [2.0.0] — 2025-04-28

### Added
- **Graphical launcher** (`launcher.py`) — full dark-themed tkinter window
  - Camera rows: checkbox, name, IP, port, resolution dropdown, fps spinner
  - Per-camera **Test** button — checks connection before launch
  - **Test All** — tests every enabled camera at once
  - **Profiles** — named presets saved to `~/.droidgrid/profiles.json`
  - Save / Load / Rename / Delete / Quick-Save profiles
  - Auto-loads last used profile on startup
  - Session settings (label, person, repeat, naming pattern, output dirs) inline
  - Browse buttons for output directories
  - Status bar with camera count badge
- `DroidGrid` class now accepts injected config (cameras, dirs, pattern, session)
  so the launcher fully controls the grid without editing code
- `python droidgrid.py` redirects to the launcher automatically

### Changed
- No code editing required to configure cameras — all done via the GUI
- `Session` class uses injected dirs/pattern instead of module-level constants

## [1.1.0] — 2025-04-21
### Fixed
- FPS integrity: VideoWriter fps measured from first 20 frames

### Added
- Recording timer, blinking REC dot, fps health colour coding

## [1.0.0] — 2025-04-21
### Added
- Initial release
