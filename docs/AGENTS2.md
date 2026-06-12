```
 ____  _____  ____  _   _     ____  __  __ _   _  ____   ___
|  _ \|  ___|/ ___|| \ | |   / ___||  \/  | \ | |/ ___| |__ \
| |_) | |_  | |    |  \| |  | |    | |\/| |  \| |\___ \   / /
|  _ <|  _| | |___ | |\  |  | |___ | |  | | |\  | ___) | |_|
|_| \_\_____|_____||_| \_|   \____|_|  |_|_| \_||____/  (_)

DroidGrid Pro — Remaining Gaps, Part 2
Agent:  OpenCode
Scope:  server.ts · App.tsx · Dockerfile.decoder
Covers: items 6–10 from the gap audit
Rev:    2025-06-10
```

---

```
┌─ SCOPE OF THIS FILE ────────────────────────────────────────────────────┐
│                                                                          │
│  This file covers the 10 remaining open items NOT handled by AGENTS.md. │
│  Apply AGENTS.md first, then this file.                                 │
│                                                                          │
│  6a  server.ts — AddonEventBus + makeAddonContext() implementation      │
│  6b  server.ts — /api/addons/:id/enable + /disable endpoints            │
│  6c  server.ts — /api/addons/:id/config GET + PUT                       │
│  7   Dockerfile.decoder  (new file)                                     │
│  7b  addons/fern-inference/requirements.txt  (new file)                 │
│  8a  App.tsx — import CameraCell + mediamtxBase state from health API   │
│  8b  App.tsx — live video grid in dashboard (WebRTC feeds)              │
│  8c  App.tsx — CameraCell in cameras tab card header                    │
│  9a  App.tsx — ONVIF discover button in cameras tab                     │
│  9b  App.tsx — discover modal state + add-to-fleet handler              │
│  10  Verification checklist                                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 6a · server.ts — AddonEventBus + makeAddonContext()

Open `DroidGrid Pro/server.ts`.

### Step 6a-1 — Add EventEmitter import

Find this block near the top of the file (with the other imports):

```typescript
import fs from "fs";
import os from "os";
import http from "http";
```

Add one line immediately after those imports:

```typescript
import { EventEmitter } from "events";
```

### Step 6a-2 — Declare addonEventBus

Find the block that begins with the constant declarations (after imports, before the `readJson` helper):

```typescript
const DATA_DIR      = path.join(os.homedir(), ".droidgrid");
```

Immediately after that block, add:

```typescript
// ── Addon event bus ────────────────────────────────────────────────────────
// All addon-to-addon and addon-to-system communication goes through here.
const addonEventBus = new EventEmitter();
addonEventBus.setMaxListeners(100);

// Loaded addon instances: id → instance
const loadedAddons: Map<string, { instance: unknown; manifest: Record<string, unknown>; enabled: boolean }> = new Map();
```

### Step 6a-3 — Add makeAddonContext() function

Find the line:

```typescript
async function loadAddons() {
```

Insert the complete `makeAddonContext` function **immediately before** it:

```typescript
function makeAddonContext(addonId: string, expressApp: express.Application) {
  const configFile = path.join(DATA_DIR, `addon_${addonId}.json`);

  function loadAddonConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(configFile)) {
        return JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
      }
    } catch {}
    return {};
  }

  function saveAddonConfig(data: Record<string, unknown>) {
    fs.writeFileSync(configFile, JSON.stringify(data, null, 2));
  }

  return {
    // Read all cameras
    getCameras: () => cameras,

    // Register an Express route under /api/addons/{addonId}/{path}
    registerRoute: (
      method: "GET" | "POST" | "PUT" | "DELETE",
      routePath: string,
      handler: (req: Request, res: Response) => void
    ) => {
      const fullPath = `/api/addons/${addonId}${routePath}`;
      (expressApp as express.Application)[method.toLowerCase() as "get" | "post" | "put" | "delete"](
        fullPath,
        handler
      );
      addLog("ADDON", `${addonId}: registered ${method} ${fullPath}`, "info");
    },

    // Emit a log entry into the DroidGrid log stream
    log: (msg: string, level: "info" | "warn" | "error" | "success" = "info") => {
      addLog(`ADDON:${addonId}`, msg, level);
    },

    // Read addon-specific config from ~/.droidgrid/addon_{id}.json
    getConfig: () => loadAddonConfig(),

    // Merge a patch into addon config and persist
    setConfig: (patch: Record<string, unknown>) => {
      const current = loadAddonConfig();
      saveAddonConfig({ ...current, ...patch });
    },

    // Emit an event on the shared addon event bus
    emit: (event: string, data: unknown) => {
      addonEventBus.emit(event, { source: addonId, data });
    },

    // Subscribe to an event on the shared addon event bus
    on: (event: string, handler: (payload: unknown) => void) => {
      addonEventBus.on(event, handler);
    },
  };
}
```

### Step 6a-4 — Fix loadAddons() to use the new map

Find the existing `loadAddons()` function. Replace only the lines inside the
`try` block where the instance is stored. The current code likely does:

```typescript
// current (may vary slightly):
const instance: DroidGridAddon = new AddonClass();
await instance.init(makeAddonContext(manifest.id, app));
loadedAddons.set(manifest.id, instance);
```

Replace those three lines with:

```typescript
const instance = new AddonClass();
await instance.init(makeAddonContext(manifest.id, app));
loadedAddons.set(manifest.id, {
  instance,
  manifest,
  enabled: true,
});
addLog("ADDON", `Loaded: ${manifest.name} v${manifest.version}`, "success");
```

---

## 6b · server.ts — Addon enable / disable endpoints

Find the line:

```typescript
app.get("/api/addons", ...
```

After the GET handler, add these four endpoints:

```typescript
// ── Addon lifecycle ────────────────────────────────────────────────────────

app.post("/api/addons/:id/enable", async (req: Request, res: Response) => {
  const entry = loadedAddons.get(req.params.id);
  if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
  entry.enabled = true;
  addLog("ADDON", `Enabled: ${req.params.id}`, "success");
  res.json({ ok: true, id: req.params.id, enabled: true });
});

app.post("/api/addons/:id/disable", async (req: Request, res: Response) => {
  const entry = loadedAddons.get(req.params.id);
  if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
  entry.enabled = false;
  // Call destroy() if the addon supports it
  try {
    const inst = entry.instance as { destroy?: () => Promise<void> };
    if (typeof inst.destroy === "function") await inst.destroy();
  } catch {}
  addLog("ADDON", `Disabled: ${req.params.id}`, "warn");
  res.json({ ok: true, id: req.params.id, enabled: false });
});
```

---

## 6c · server.ts — Addon config GET / PUT

Directly after the enable/disable endpoints, add:

```typescript
app.get("/api/addons/:id/config", (req: Request, res: Response) => {
  const entry = loadedAddons.get(req.params.id);
  if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
  const configFile = path.join(DATA_DIR, `addon_${req.params.id}.json`);
  try {
    const cfg = fs.existsSync(configFile)
      ? JSON.parse(fs.readFileSync(configFile, "utf8"))
      : {};
    res.json(cfg);
  } catch {
    res.json({});
  }
});

app.put("/api/addons/:id/config", (req: Request, res: Response) => {
  const entry = loadedAddons.get(req.params.id);
  if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
  const configFile = path.join(DATA_DIR, `addon_${req.params.id}.json`);
  let current: Record<string, unknown> = {};
  try {
    if (fs.existsSync(configFile))
      current = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch {}
  const updated = { ...current, ...(req.body as Record<string, unknown>) };
  fs.writeFileSync(configFile, JSON.stringify(updated, null, 2));
  addLog("ADDON", `Config updated: ${req.params.id}`, "info");
  res.json(updated);
});
```

Also fix the existing `/api/addons` GET endpoint to return the right shape.
Find:

```typescript
app.get("/api/addons", (_req, res) => res.json(getAddonList()));
```

Replace with:

```typescript
app.get("/api/addons", (_req: Request, res: Response) => {
  const list = Array.from(loadedAddons.entries()).map(([id, entry]) => ({
    id,
    name:    (entry.manifest as Record<string, unknown>).name ?? id,
    version: (entry.manifest as Record<string, unknown>).version ?? "0.0.0",
    enabled: entry.enabled,
  }));
  res.json(list);
});
```

### Verify 6a–6c

```bash
npx tsx DroidGrid\ Pro/server.ts
# Should start cleanly.

curl http://localhost:3000/api/addons
# Returns [] if addons/ directory is empty — that is correct.

# If fern-inference addon is present:
# Returns [{ "id": "fern-inference", "name": "FERN Foot Gesture Recognition",
#            "version": "2.0.0", "enabled": true }]
```

---

## 7 · Dockerfile.decoder (new file)

**Create file at:** `DroidGrid Pro/Dockerfile.decoder`

```dockerfile
# ── DroidGrid VNF-Decoder ─────────────────────────────────────────────────
# Python + ONNX Runtime + MediaPipe inference container.
# GPU: set runtime: nvidia in docker-compose.yml (requires nvidia-container-toolkit)
# CPU: remove the runtime line from docker-compose.yml and use onnxruntime
# ─────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

# System deps required by OpenCV headless and MediaPipe
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libgomp1 \
        libgl1 \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for Docker layer caching
COPY addons/fern-inference/requirements.txt ./requirements.txt

# Install Python deps
# onnxruntime-gpu requires CUDA toolkit on the host; swap for onnxruntime on CPU-only
RUN pip install --no-cache-dir -r requirements.txt

# Copy inference script
COPY addons/fern-inference/inference.py ./inference.py

# Default: print help (actual command set by docker-compose environment)
CMD ["python", "inference.py", "--help"]
```

---

## 7b · addons/fern-inference/requirements.txt (new file)

**Create file at:** `addons/fern-inference/requirements.txt`

```text
# DroidGrid vnf-decoder — Python dependencies
# For GPU inference swap onnxruntime → onnxruntime-gpu
opencv-python-headless>=4.8.0
numpy>=1.24.0
onnxruntime>=1.17.0
mediapipe>=0.10.14
requests>=2.31.0
```

### Update docker-compose.yml vnf-decoder service

Find the `vnf-decoder` service in `docker-compose.yml`.

Replace the `command:` or `CMD`-style invocation with the actual inference
call. The service should look like this after the edit:

```yaml
  vnf-decoder:
    build:
      context: .
      dockerfile: DroidGrid Pro/Dockerfile.decoder
    container_name: droidgrid-decoder
    network_mode: host
    volumes:
      - ./models:/models:ro
    environment:
      - MEDIAMTX_URL=rtsp://localhost:8554
      - INFERENCE_MODEL=/models/fern_v2.onnx
      - MEDIAPIPE_TASK=/models/pose_landmarker_heavy.task
    command: >
      python inference.py
        --model        /models/fern_v2.onnx
        --mediapipe    /models/pose_landmarker_heavy.task
        --rtsp_url     rtsp://localhost:8554/phone1
        --n_cameras    1
        --camera_id    0
        --window_size  60
        --confidence   0.6
        --sync_offset_sec 4.0
    restart: on-failure
    depends_on: [vnf-ingest]
```

If the NVIDIA runtime is available on the host, also add:

```yaml
    runtime: nvidia
```

### Verify Dockerfile.decoder builds

```bash
docker build -f "DroidGrid Pro/Dockerfile.decoder" -t droidgrid/decoder:test .
# Should complete without error.
# Final line: Successfully tagged droidgrid/decoder:test
```

---

## 8a · App.tsx — mediamtxBase state + CameraCell import

Open `DroidGrid Pro/src/App.tsx`.

### Step 8a-1 — Import CameraCell

Find the first import line at the top of App.tsx:

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
```

Add the CameraCell import on the line immediately after all other imports
(after the last `import` statement, before the first `interface` or `const`):

```tsx
import { CameraCell } from './components/CameraCell';
```

### Step 8a-2 — Add mediamtxBase state

Find this block of `useState` declarations near the top of the `App()` component:

```tsx
const [cameras, setCameras]       = useState<Camera[]>([]);
const [profiles, setProfiles]     = useState<Profile[]>([]);
```

Add one line immediately after the `cameras` state:

```tsx
const [mediamtxBase, setMediamtxBase] = useState<string>("http://localhost:8889");
```

### Step 8a-3 — Populate mediamtxBase from health endpoint

Find the `refresh` callback. It calls `api.get('/api/health')` already.
That result is currently unused for mediamtxBase. Update the destructuring:

```tsx
// Find this line inside the refresh callback:
const [cams, prof, sess, logsData, recStatus] = await Promise.all([
  api.get('/api/cameras'),
  api.get('/api/profiles'),
  api.get('/api/session'),
  api.get('/api/logs'),
  api.get('/api/recording/status'),
]);
```

Add one more parallel call to the array and the destructuring:

```tsx
const [cams, prof, sess, logsData, recStatus, health] = await Promise.all([
  api.get('/api/cameras'),
  api.get('/api/profiles'),
  api.get('/api/session'),
  api.get('/api/logs'),
  api.get('/api/recording/status'),
  api.get('/api/health'),                  // ← add this
]);
```

Then immediately after the `setRecording(recStatus.recording)` line, add:

```tsx
if (health?.mediamtxBase) setMediamtxBase(health.mediamtxBase);
```

---

## 8b · App.tsx — Live Video Grid in Dashboard

Find the `renderDashboard()` function. Inside it, find the `Camera grid status`
BentoCard — it currently looks like this:

```tsx
{/* Camera grid status */}
<BentoCard className="md:col-span-4 md:row-span-1 flex-row items-center gap-5">
  <div className="flex gap-2 flex-wrap">
    {cameras.map(c => (
      <div key={c.id} ...>
        <StatusDot status={c.status} />
        <span ...>{c.name}</span>
      </div>
    ))}
    ...
  </div>
</BentoCard>
```

Replace that entire BentoCard with the live video grid below.
The grid spans the same `md:col-span-4 md:row-span-1` slot but now shows
actual WebRTC feeds when cameras are online and status dots when offline.

```tsx
{/* Live Camera Grid */}
<BentoCard className="md:col-span-4 md:row-span-1" sub="LIVE FEEDS">
  <div className="grid grid-cols-3 gap-2 w-full">
    {cameras.filter(c => c.enabled).slice(0, 6).map(cam => (
      <div key={cam.id} className="relative rounded-lg overflow-hidden bg-black aspect-video">
        {(cam.status === 'online' || cam.status === 'recording') ? (
          <CameraCell
            camName={cam.name.toLowerCase().replace(/[\s_]+/g, '-')}
            mediamtxBase={mediamtxBase}
            isRecording={cam.status === 'recording'}
            status={cam.status}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <StatusDot status={cam.status} />
            <span className="text-[9px] font-mono text-text-dim uppercase">{cam.name}</span>
            <span className="text-[8px] text-text-dim/60">{cam.status}</span>
          </div>
        )}
        {cam.status === 'recording' && (
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>
    ))}
    {cameras.filter(c => c.enabled).length === 0 && (
      <div className="col-span-3 text-center py-4 text-text-dim text-xs">
        No cameras enabled
      </div>
    )}
  </div>
</BentoCard>
```

---

## 8c · App.tsx — CameraCell in cameras tab detail

Find `renderCameras()`. Inside it, find the `<BentoCard>` that wraps the
camera list (the one containing `<AnimatePresence>` and `<CameraRow />`).

In the header row of that card (the `div` with "Camera Fleet" title), add a
live-preview toggle. Find:

```tsx
<h3 className="text-sm font-bold text-white uppercase tracking-widest">Camera Fleet</h3>
<p className="text-[10px] text-text-dim mt-0.5">{onlineCount}/{cameras.length} online ...</p>
```

Add a `showLive` state toggle button after those two elements:

First, add the state near the top of `App()` (with the other state declarations):

```tsx
const [showLive, setShowLive] = useState(false);
```

Then in the cameras tab header, add after the description `<p>`:

```tsx
<button
  onClick={() => setShowLive(v => !v)}
  className={`mt-1 text-[9px] px-2 py-0.5 rounded border transition-all font-mono uppercase
    ${showLive
      ? 'border-brand/40 text-brand bg-brand/5'
      : 'border-surface-border text-text-dim hover:text-white'}`}
>
  {showLive ? '▣ Hide Live' : '▷ Show Live'}
</button>
```

Then, directly above the `<AnimatePresence>` camera list, add:

```tsx
{showLive && cameras.some(c => c.status === 'online' || c.status === 'recording') && (
  <div className="grid grid-cols-2 gap-3 mb-4">
    {cameras
      .filter(c => c.enabled && (c.status === 'online' || c.status === 'recording'))
      .map(cam => (
        <div key={cam.id}
          className="relative rounded-lg overflow-hidden bg-black aspect-video border border-surface-border">
          <CameraCell
            camName={cam.name.toLowerCase().replace(/[\s_]+/g, '-')}
            mediamtxBase={mediamtxBase}
            isRecording={cam.status === 'recording'}
            status={cam.status}
          />
          <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/60 text-[9px] font-mono text-text-muted">
            {cam.name}
          </div>
        </div>
      ))
    }
  </div>
)}
```

---

## 9a · App.tsx — ONVIF Discover button

### Step 9a-1 — Add discover state

Add these state declarations near the other `useState` calls in `App()`:

```tsx
const [discovering,    setDiscovering]    = useState(false);
const [discoveredCams, setDiscoveredCams] = useState<
  Array<{ address: string; name?: string; rtsp_url?: string }>
>([]);
const [showDiscoverModal, setShowDiscoverModal] = useState(false);
```

### Step 9a-2 — Add discoverCameras handler

Add this function inside `App()`, near the other camera action handlers:

```tsx
const discoverCameras = async () => {
  setDiscovering(true);
  try {
    const r = await api.post('/api/cameras/discover');
    if (r.ok && Array.isArray(r.found)) {
      setDiscoveredCams(r.found);
      setShowDiscoverModal(true);
    } else {
      showToast(r.error || 'No ONVIF cameras found', false);
    }
  } catch {
    showToast('Discovery failed — is onvif-zeep installed?', false);
  } finally {
    setDiscovering(false);
  }
};
```

### Step 9a-3 — Add Discover button to cameras tab header

Find in `renderCameras()` the button row with "Test All" and "Add Camera":

```tsx
<button onClick={testAll} ...>
  <RefreshCw size={12}/> Test All
</button>
<button onClick={addCamera} ...>
  <Plus size={12}/> Add Camera
</button>
```

Add a third button immediately before "Add Camera":

```tsx
<button
  onClick={discoverCameras}
  disabled={discovering}
  className="flex items-center gap-1.5 bg-surface-border/50 text-text-muted
             hover:text-white border border-surface-border px-3 py-1.5 rounded-lg
             text-xs transition-all disabled:opacity-40"
>
  {discovering
    ? <Loader size={12} className="animate-spin"/>
    : <Search size={12}/>
  }
  {discovering ? 'Scanning...' : 'Discover ONVIF'}
</button>
```

---

## 9b · App.tsx — Discover modal

Add the `DiscoverModal` component function inside App.tsx (before the
`return` statement of `App()`):

```tsx
const DiscoverModal = () => {
  if (!showDiscoverModal) return null;

  const addDiscovered = async (cam: { address: string; rtsp_url?: string; name?: string }) => {
    const name = cam.name ?? `ONVIF-${Date.now()}`;
    // Parse IP from address URL  e.g. http://192.168.1.200:80/onvif/device_service
    const ipMatch = cam.address.match(/https?:\/\/([\d.]+)/);
    const ip = ipMatch?.[1] ?? cam.address;
    const added = await api.post('/api/cameras', {
      name,
      ip,
      port: 554,
      res: [1920, 1080],
      fps: 25,
      url: cam.rtsp_url ?? undefined,
    });
    setCameras(prev => [...prev, added]);
    showToast(`Added: ${name}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={() => setShowDiscoverModal(false)}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-surface-card border border-surface-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 border-b border-surface-border relative">
          <button
            onClick={() => setShowDiscoverModal(false)}
            className="absolute top-6 right-6 text-text-dim hover:text-white p-2 rounded-full hover:bg-white/5"
          >
            <X size={20}/>
          </button>
          <span className="text-brand text-xs font-mono uppercase tracking-[0.2em] mb-2 block">
            ONVIF Discovery
          </span>
          <h2 className="text-2xl font-black text-white">
            {discoveredCams.length} Camera{discoveredCams.length !== 1 ? 's' : ''} Found
          </h2>
        </div>

        <div className="p-6 max-h-80 overflow-y-auto custom-scrollbar">
          {discoveredCams.length === 0 ? (
            <p className="text-text-dim text-sm text-center py-6">
              No ONVIF cameras found on this network.
            </p>
          ) : (
            <div className="space-y-3">
              {discoveredCams.map((cam, i) => {
                const alreadyAdded = cameras.some(c => c.ip && cam.address.includes(c.ip));
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-xl
                               bg-black/30 border border-surface-border"
                  >
                    <div>
                      <p className="text-xs text-white font-mono">
                        {cam.name ?? `Camera ${i + 1}`}
                      </p>
                      <p className="text-[9px] text-text-dim mt-0.5 truncate max-w-[260px]">
                        {cam.address}
                      </p>
                      {cam.rtsp_url && (
                        <p className="text-[9px] text-brand/60 mt-0.5 truncate max-w-[260px]">
                          {cam.rtsp_url}
                        </p>
                      )}
                    </div>
                    {alreadyAdded ? (
                      <span className="text-[9px] text-text-dim border border-surface-border
                                       px-2 py-1 rounded">
                        Added
                      </span>
                    ) : (
                      <button
                        onClick={() => addDiscovered(cam)}
                        className="text-[9px] px-3 py-1.5 bg-brand/10 text-brand rounded
                                   border border-brand/20 hover:bg-brand/20 transition-all"
                      >
                        + Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-surface-border">
          <button
            onClick={() => setShowDiscoverModal(false)}
            className="w-full bg-surface-border/50 text-text-dim hover:text-white
                       py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};
```

### Register DiscoverModal in the JSX return

Find the `<AnimatePresence>` block near the bottom of the App return that
renders the ProfileModal:

```tsx
<AnimatePresence>{selectedProfile && <ProfileModal/>}</AnimatePresence>
```

Add DiscoverModal on the line immediately after:

```tsx
<AnimatePresence>{showDiscoverModal && <DiscoverModal/>}</AnimatePresence>
```

---

## 10 · Verification checklist

Run each check in order. Do not proceed to the next check until the current
one passes.

```
┌─ server.ts ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  □  npx tsx server.ts starts without TypeScript errors                  │
│  □  GET  /api/addons          returns []  (no addons) or addon list     │
│  □  POST /api/addons/X/enable returns {ok:true, enabled:true}          │
│  □  GET  /api/addons/X/config returns {} or saved config               │
│  □  PUT  /api/addons/X/config with body {key:val} persists to disk     │
│         check: cat ~/.droidgrid/addon_X.json                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Dockerfile.decoder ────────────────────────────────────────────────────┐
│                                                                          │
│  □  docker build -f "DroidGrid Pro/Dockerfile.decoder" -t dg/dec .     │
│     exits 0                                                              │
│  □  docker run --rm dg/dec python inference.py --help                   │
│     prints usage without error                                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ App.tsx ────────────────────────────────────────────────────────────────┐
│                                                                          │
│  □  npm run dev compiles without TypeScript errors                      │
│  □  Dashboard loads — live grid section visible                          │
│  □  Online camera card shows <video> element (inspect DOM)              │
│  □  Offline camera card shows status dot + name (no video element)      │
│  □  Cameras tab → "Show Live" button toggles live preview grid         │
│  □  Cameras tab → "Discover ONVIF" button appears in header row        │
│  □  Clicking Discover ONVIF calls POST /api/cameras/discover           │
│  □  If onvif-zeep not installed: toast "Discovery failed..." shown     │
│  □  If cameras found: modal opens with camera list + Add buttons       │
│  □  Clicking Add in modal calls POST /api/cameras and updates list     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Full stack integration ────────────────────────────────────────────────┐
│                                                                          │
│  □  docker compose up starts all 4 VNF containers without error        │
│  □  mediamtx container shows "listener opened on :8554"                 │
│  □  mediamtx container shows "listener opened on :9997" (API)          │
│  □  vnf-decoder container exits cleanly (expected: model not mounted)  │
│  □  vnf-api container shows DroidGrid backend ready on :3000           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Complete gap closure map

```
┌─ After applying AGENTS.md + AGENTS2.md ────────────────────────────────────┐
│                                                                              │
│  Phase 1  Protocol Bridge              ████████████████████  5/6 ✓         │
│  Phase 2  FFMPEG Recorder              ████████████████████  5/6 ✓         │
│  Phase 3  WebRTC Live View             ████████████████████  5/5 ✓         │
│  Phase 4  IP Camera / ONVIF            ████████████████████  5/5 ✓         │
│  NFV/VNF  Docker stack                 ████████████████████  6/6 ✓         │
│  Addon    System                       ████████████████████  6/6 ✓         │
│  FERN     Integration                  ████████████████████  8/8 ✓         │
│  Rec.Asst Sync                         ████████████████████  7/7 ✓         │
│  TUI      Design                       ████████████████████  4/4 ✓         │
│                                                                              │
│  Remaining intentional gaps (out of scope per proposal):                     │
│  ○  HLS fallback             low priority, browser support is wide now      │
│  ○  PTZ control via ONVIF    Phase 4 future item                            │
│  ○  Multi-node edge cluster  §6.2 — separate deployment project             │
│  ○  Hybrid edge-cloud        §6.3 — separate deployment project             │
│  ○  End-to-end live test     must be done on real hardware with phones      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## File delivery map

```
┌─ Files modified by AGENTS2.md ──────────────────────────────────────────────┐
│                                                                              │
│  DroidGrid Pro/server.ts          §6a–6c  (4 targeted insertions)           │
│  DroidGrid Pro/src/App.tsx        §8a–9b  (6 targeted insertions)           │
│  DroidGrid Pro/Dockerfile.decoder §7      (new file)                        │
│  addons/fern-inference/           §7b     (new requirements.txt)            │
│  docker-compose.yml               §7      (vnf-decoder command updated)     │
│                                                                              │
│  No files from AGENTS.md are re-touched.                                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Rollback

```powershell
# All originals are in .backups/20260607_212316/
Copy-Item ".backups\20260607_212316\pro_App.tsx"    "DroidGrid Pro\src\App.tsx" -Force
Copy-Item ".backups\20260607_212316\pro_server.ts"  "DroidGrid Pro\server.ts"   -Force
# Dockerfile.decoder and requirements.txt are new — just delete them:
Remove-Item "DroidGrid Pro\Dockerfile.decoder"      -ErrorAction SilentlyContinue
Remove-Item "addons\fern-inference\requirements.txt" -ErrorAction SilentlyContinue
```

---

```
 main ─ Vision-Orchestration ─ DroidGrid gap closure ─ rev 2025-06-10
```
