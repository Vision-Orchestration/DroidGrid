# DroidGrid Addon System — Contribution Guide

DroidGrid's addon system lets you extend the platform with custom camera processing, external integrations, UI panels, and more. Addons are self-contained directories loaded at runtime — no core code changes needed.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Quick Start: Your First Addon](#2-quick-start-your-first-addon)
3. [Addon Manifest (addon.json)](#3-addon-manifest-addonjson)
4. [Addon API Reference](#4-addon-api-reference)
5. [Permissions System](#5-permissions-system)
6. [Configuration & Persistence](#6-configuration--persistence)
7. [UI Integration](#7-ui-integration)
8. [Event System](#8-event-system)
9. [Python Subprocess Addons](#9-python-subprocess-addons)
10. [Best Practices](#10-best-practices)
11. [Troubleshooting](#11-troubleshooting)
12. [Example: Complete Addon](#12-example-complete-addon)

---

## 1. Architecture Overview

```
addons/
├── my-addon/
│   ├── addon.json         # Manifest (required)
│   └── index.ts           # Entry point (required, default export)
├── fern-inference/        # Built-in: FERN gesture recognition
└── gridflow-bridge/       # Built-in: external data pipeline
```

**Lifecycle:**
1. Server starts → scans `addons/` directory
2. Reads each `addon.json` manifest
3. Imports the entry file (default export must be a class)
4. Calls `instance.init(ctx)` with an `AddonContext`
5. Addon registers routes, sets up listeners, spawns processes
6. On server stop: calls `instance.destroy()` for cleanup

**Runtime architecture:**
```
DroidGrid Server
  ├── AddonLoader
  │   ├── scans addons/ directory
  │   ├── reads addon.json manifest
  │   └── imports entry file → calls init(ctx)
  ├── AddonContext
  │   ├── getCameras()        → live camera list
  │   ├── registerRoute()     → add REST endpoints
  │   ├── log()               → write to DroidGrid log
  │   ├── getConfig()         → read persisted config
  │   ├── setConfig()         → write persisted config
  │   ├── emit()              → publish events
  │   └── on()                → subscribe to events
  └── Loaded Addons Map
      ├── "fern-inference" → { id, instance }
      └── "gridflow-bridge" → { id, instance }
```

---

## 2. Quick Start: Your First Addon

### Step 1: Create the directory and manifest

```
addons/hello-world/
├── addon.json
└── index.ts
```

**addon.json:**
```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "Minimal example addon",
  "author": "Your Name",
  "entry": "index.ts",
  "permissions": ["api.register"],
  "config": {
    "greeting": { "type": "string", "default": "Hello from DroidGrid!", "description": "The greeting message" }
  }
}
```

**index.ts:**
```typescript
interface AddonContext {
  getCameras(): any[];
  registerRoute(method: "GET"|"POST"|"PUT"|"DELETE", path: string, handler: Function): void;
  log(msg: string, level?: "info"|"warn"|"error"|"success"): void;
  getConfig(): Record<string, unknown>;
  setConfig(patch: Record<string, unknown>): void;
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
}

export default class HelloWorldAddon {
  id = "hello-world";

  async init(ctx: AddonContext) {
    const cfg = ctx.getConfig();
    ctx.log(`Addon initialised: ${cfg.greeting}`, "success");

    ctx.registerRoute("GET", "/hello", (_req: any, res: any) => {
      res.json({
        message: cfg.greeting,
        cameras: ctx.getCameras().length,
        timestamp: new Date().toISOString(),
      });
    });

    ctx.registerRoute("GET", "/cameras", (_req: any, res: any) => {
      res.json(ctx.getCameras());
    });
  }

  async destroy() {
    console.log("Goodbye!");
  }
}
```

### Step 2: Restart or reload

```bash
# Restart the server
npm run dev

# Or reload via API
curl -X POST http://localhost:3000/api/addons/hello-world/reload
```

### Step 3: Verify

```
GET http://localhost:3000/api/addons/hello-world/hello
→ { "message": "Hello from DroidGrid!", "cameras": 3, "timestamp": "..." }
```

---

## 3. Addon Manifest (addon.json)

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | **yes** | Unique identifier (kebab-case). Used for routes and persistence. |
| `name` | string | **yes** | Human-readable name. |
| `version` | string | **yes** | Semver version string. |
| `description` | string | no | Short description shown in the Extensions tab. |
| `author` | string | no | Author name/org. |
| `entry` | string | **yes** | Entry file relative to addon directory (e.g. `index.ts`, `index.js`). |
| `permissions` | string[] | no | Required permissions. See [§5](#5-permissions-system). |
| `config` | object | no | Declared config schema with defaults. |
| `ui.panel` | boolean | no | Whether addon has a UI panel (future use). |
| `ui.settings` | boolean | no | Whether addon has settings (future use). |

### Config schema fields

Each config entry supports:

| Field | Type | Description |
|---|---|---|
| `type` | `"string"` `"number"` `"boolean"` | Value type |
| `default` | any | Default value |
| `description` | string | Help text |
| `enum` | string[] | Allowed values (for string type) |

---

## 4. Addon API Reference

The `AddonContext` object is passed to `init()` and provides all integration points.

### `getCameras(): Camera[]`

Returns the current list of cameras. Each camera object:

```typescript
{
  id: string;           // "cam-1712345678"
  name: string;         // "Phone-1"
  ip: string;           // "192.168.1.101"
  port: number;         // 4747
  res: [number, number];// [1280, 720]
  fps: number;          // 30
  enabled: boolean;     // true
  status: "online"|"offline"|"checking"|"recording";
}
```

### `registerRoute(method, path, handler)`

Register a REST route under `/api/addons/<addonId>/<path>`.

```typescript
ctx.registerRoute("GET", "/status", (req, res) => {
  res.json({ running: true });
});
// → GET /api/addons/my-addon/status
```

Supported methods: `"GET"`, `"POST"`, `"PUT"`, `"DELETE"`.

### `log(msg, level?)`

Write a message to the DroidGrid log stream.

```typescript
ctx.log("Processing frame #42", "info");
ctx.log("Inference failed", "error");
ctx.log("Gesture detected!", "success");
ctx.log("Temperature high", "warn");
```

### `getConfig(): Record<string, unknown>`

Read the addon's persisted configuration from `~/.droidgrid/addons/<id>.json`.

Returns the merged default + saved values.

### `setConfig(patch: Record<string, unknown>): void`

Update the addon's configuration. Merges with existing values.

```typescript
ctx.setConfig({ threshold: 0.8, enabled: true });
```

### `emit(event, data)`

Publish an event to the DroidGrid event bus.

```typescript
ctx.emit("my-addon:frame-processed", { cameraId: "cam-1", elapsed: 12 });
```

Event names should be namespaced: `<addon-id>:<event-name>`.

### `on(event, handler)`

Subscribe to events from the DroidGrid event bus.

```typescript
ctx.on("fern:gesture", (data) => {
  ctx.log(`Gesture detected: ${data.gesture}`);
});
```

Built-in events:

| Event | Payload | Description |
|---|---|---|
| `fern:gesture` | `{ gesture, confidence, timestamp }` | FERN gesture detected |

---

## 5. Permissions System

Declare required permissions in `addon.json`:

```json
{
  "permissions": ["cameras.read", "recording.events", "ui.panel", "api.register"]
}
```

| Permission | Description |
|---|---|
| `cameras.read` | Access camera list and status |
| `cameras.write` | Modify camera configuration |
| `recording.start` | Start recordings |
| `recording.stop` | Stop recordings |
| `recording.events` | Receive recording start/stop events |
| `api.register` | Register custom REST routes |
| `ui.panel` | Show a panel in the DroidGrid UI |
| `ui.settings` | Add settings to the DroidGrid settings page |

---

## 6. Configuration & Persistence

Each addon gets its own config file at `~/.droidgrid/addons/<id>.json`.

**How defaults work:**
1. Manifest declares `config` with `default` values
2. On first load, defaults are used
3. When `setConfig()` is called, the config is persisted
4. `getConfig()` merges saved values with defaults

**Example config file (`~/.droidgrid/addons/hello-world.json`):**
```json
{
  "greeting": "Custom greeting",
  "threshold": 0.85
}
```

---

## 7. UI Integration

(Coming in a future release)

Addons can declare UI components via the `ui` field in the manifest:

```json
{
  "ui": {
    "panel": true,
    "settings": true
  }
}
```

- `panel: true` — addon gets a panel in the DroidGrid sidebar
- `settings: true` — addon gets a section in the Settings page

---

## 8. Event System

The event bus enables addon-to-addon communication.

**Emitting events:**
```typescript
ctx.emit("my-addon:data-ready", { frames: 120, fps: 29.7 });
```

**Subscribing to events:**
```typescript
ctx.on("fern:gesture", (data: any) => {
  if (data.confidence > 0.8) {
    ctx.log(`High-confidence gesture: ${data.gesture}`);
  }
});
```

**Convention:** Always namespace events with your addon ID to avoid collisions.

---

## 9. Python Subprocess Addons

Addons can spawn Python processes for ML inference, image processing, etc.
See the `fern-inference` addon as a reference implementation.

**Pattern:**
1. Spawn a Python child process in `init()`
2. Stream JSON events via stdout (newline-delimited)
3. Parse lines in the TypeScript parent and emit to the event bus
4. Handle exit/crash with auto-restart logic

**Example stdout protocol:**
```python
# inference.py
import json, time
while True:
    event = {"gesture": "foot_lift", "confidence": 0.92, "timestamp": time.time()}
    print(json.dumps(event), flush=True)
```

**TypeScript side:**
```typescript
import { spawn } from "child_process";
import { createInterface } from "readline";

const proc = spawn("python", ["path/to/script.py"]);
const rl = createInterface({ input: proc.stdout! });
rl.on("line", (line) => {
  try { ctx.emit("my-addon:event", JSON.parse(line)); } catch {}
});
```

---

## 10. Best Practices

### Do
- **Namespace your events** — prefix with addon ID (`my-addon:frame-ready`)
- **Handle crashes gracefully** — restart subprocesses on unexpected exit
- **Use `destroy()`** — clean up timers, close connections, kill subprocesses
- **Log meaningfully** — use `ctx.log()` with appropriate levels
- **Validate config** — check required fields in `init()` before using them
- **Keep routes simple** — each route should do one thing well

### Don't
- **Don't modify core files** — addons should never edit `server.ts` or other core code
- **Don't block the event loop** — use async/await, avoid synchronous long operations
- **Don't hardcode paths** — use `path.join(process.cwd(), "addons", ...)` for relative paths
- **Don't leak file handles** — always close files, streams, and connections in `destroy()`

### Performance
- Use streaming for large data (don't buffer entire frames in memory)
- Batch API calls instead of making one request per frame
- Use `setInterval` carefully — clean up in `destroy()`
- For Python subprocesses, use `--buffering=0` or `flush=True` for real-time output

---

## 11. Troubleshooting

### Addon not showing in Extensions tab
- Check `addons/<id>/addon.json` exists and is valid JSON
- Check the `id` field is unique and kebab-case
- Check the `entry` file exists
- Check server logs for load errors
- Restart the server or call `POST /api/addons/<id>/reload`

### Route returns 404
- Routes are prefixed with `/api/addons/<id>/`
- Check the addon has `"api.register"` in permissions
- Check the addon was loaded (GET /api/addons)

### Subprocess crashes immediately
- Run the Python script directly to test: `python addons/my-addon/script.py`
- Check Python environment has all required packages
- Check file paths are correct (use absolute paths)
- Check stderr in server logs for Python errors

### Config not persisting
- Check `~/.droidgrid/addons/<id>.json` exists and is valid JSON
- Check you're calling `setConfig()` not `getConfig()`
- Config is written synchronously — should be available immediately

---

## 12. Example: Complete Addon

See the built-in addons in `addons/` directory for complete, working examples:

| Addon | Description | Key Techniques |
|---|---|---|
| `fern-inference/` | FERN gesture recognition | Python subprocess, ONNX, MediaPipe, event emission |
| `gridflow-bridge/` | External data pipeline bridge | HTTP forwarding, periodic sync, config management |

--- 

*For questions or feature requests, open an issue on the DroidGrid repository.*
