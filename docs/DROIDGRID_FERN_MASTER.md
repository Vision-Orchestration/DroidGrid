```
 ____        _     _  ____      _     _
|  _ \ _ __ (_) __| |/ ___|_ __(_) __| |
| | | | '__|| |/ _` | |  _| '__| |/ _` |
| |_| | |   | | (_| | |_| | |  | | (_| |
|____/|_|   |_|\__,_|\____|_|  |_|\__,_|

  + FERN integration layer
  Vision-Orchestration — Master Instruction Set
  rev 2025-06-07 — all phases, all systems
```

---

```
┌─ INDEX ─────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  PART I    DroidGrid — Next-Generation Implementation          [§1–§4]       │
│    §1      Phase 1 · Protocol Bridge (MediaMTX)                             │
│    §2      Phase 2 · FFMPEG Pass-Through Recorder                           │
│    §3      Phase 3 · WebRTC Live View in Browser                            │
│    §4      Phase 4 · IP Camera and ONVIF Support                            │
│                                                                              │
│  PART II   NFV / VNF Deployment                                [§5–§7]       │
│    §5      Docker Compose VNF Stack                                          │
│    §6      Service Function Chain Configuration                              │
│    §7      Fault Isolation and Resource Descriptors                          │
│                                                                              │
│  PART III  Addon System Architecture                           [§8–§9]       │
│    §8      Addon Interface Specification                                     │
│    §9      Built-in Addon Catalogue                                          │
│                                                                              │
│  PART IV   FERN Integration                                    [§10–§12]     │
│    §10     FERN as DroidGrid Addon                                           │
│    §11     Stream → Inference Pipeline                                       │
│    §12     Recording Assistant Integration                                   │
│                                                                              │
│  PART V    FERN — Alpha Phase Tasks                            [§13–§17]     │
│    §13     Current Data State and Directory Map                              │
│    §14     Camera-ID Flag Experiment (Phase 1 + 2)                          │
│    §15     Alpha Fixes and Pipeline Tasks                                    │
│    §16     Training Commands Reference                                       │
│    §17     Success Criteria and Evaluation                                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

── · ──

---

## PART I — DroidGrid: Next-Generation Implementation

---

### §1 · Phase 1 — Protocol Bridge

**Goal:** Replace direct MJPEG polling with a MediaMTX broker.
**Effort:** 1–2 days. **Expected FPS gain:** +30–50% at 5 cameras.
**Hardware needed:** none.

The root bottleneck is not bandwidth. It is per-frame JPEG decode cost.
A 720p MJPEG stream at 30fps requires 30 full JPEG decodes per second per
camera. MediaMTX decouples camera connections from the Python process,
eliminates one FFMPEG context per camera, and enables hardware decode later.

```
  Before:  Python → cv2.VideoCapture → camera (1 FFMPEG ctx per cam)
  After:   Python → cv2.VideoCapture → MediaMTX → camera (1 ctx total per cam)
```

#### 1.1 Install MediaMTX

```bash
# Docker (recommended)
docker pull bluenviron/mediamtx:latest

# Or binary — download from:
# https://github.com/bluenviron/mediamtx/releases
# Extract to C:\droidgrid\mediamtx\
```

#### 1.2 mediamtx.yml — minimal config for DroidCam phones

```yaml
# C:\droidgrid\mediamtx\mediamtx.yml

logLevel: info
logDestinations: [stdout]

rtspAddress: :8554
rtmpAddress: :1935
hlsAddress: :8888
webrtcAddress: :8889

paths:

  # Add one block per phone.
  # Replace IPs with your DroidCam phone IPs.

  phone1:
    source: http://192.168.137.101:4747/mjpegfeed?1280x720
    sourceOnDemand: no        # keep connection alive always
    sourceOnDemandStartTimeout: 10s
    sourceOnDemandCloseAfter: 0s

  phone2:
    source: http://192.168.137.102:4747/mjpegfeed?1280x720
    sourceOnDemand: no

  phone3:
    source: http://192.168.137.103:4747/mjpegfeed?1280x720
    sourceOnDemand: no

  phone4:
    source: http://192.168.137.104:4747/mjpegfeed?1280x720
    sourceOnDemand: no

  phone5:
    source: http://192.168.137.105:4747/mjpegfeed?1280x720
    sourceOnDemand: no
```

#### 1.3 Start MediaMTX

```bash
# Docker
docker run --rm -d \
  --name mediamtx \
  --network host \
  -v ./mediamtx.yml:/mediamtx.yml \
  bluenviron/mediamtx:latest

# Or binary (Windows)
.\mediamtx.exe .\mediamtx.yml
```

#### 1.4 Update droidgrid.py — one line change per camera

Find the `CAMERAS` list and change the URL format:

```python
# Before
{"name": "Phone-1", "ip": "192.168.137.101", "port": 4747, ...}

# url property was:
# http://192.168.137.101:4747/mjpegfeed?1280x720

# After — point to MediaMTX internal RTSP
CAMERAS = [
    {"name": "Phone-1", "url": "rtsp://localhost:8554/phone1", "res": (1280,720), "fps": 30},
    {"name": "Phone-2", "url": "rtsp://localhost:8554/phone2", "res": (1280,720), "fps": 30},
    {"name": "Phone-3", "url": "rtsp://localhost:8554/phone3", "res": (1280,720), "fps": 30},
    {"name": "Phone-4", "url": "rtsp://localhost:8554/phone4", "res": (1280,720), "fps": 30},
    {"name": "Phone-5", "url": "rtsp://localhost:8554/phone5", "res": (1280,720), "fps": 30},
]
```

Update the `Camera.url` property:

```python
@property
def url(self) -> str:
    # If a full URL is provided, use it directly
    if hasattr(self, '_url'):
        return self._url
    # Legacy fallback: build MJPEG URL from ip/port
    w, h = self.res
    return f"http://{self.ip}:{self.port}/mjpegfeed?{w}x{h}"
```

#### 1.5 Verify

```bash
# Test RTSP stream with FFMPEG
ffmpeg -i rtsp://localhost:8554/phone1 -frames:v 1 test_frame.jpg

# Or open in VLC:
# Media > Open Network Stream > rtsp://localhost:8554/phone1
```

```
  Status checks:
  ─────────────────────────────────────────────────────────
  MediaMTX log shows "source alive"   → ✓ broker connected
  FFMPEG grabs a frame                → ✓ RTSP works
  DroidGrid shows camera preview      → ✓ integration done
  FPS is higher than before           → ✓ bottleneck reduced
```

── · ──

### §2 · Phase 2 — FFMPEG Pass-Through Recorder

**Goal:** Move recording entirely out of Python. Zero decode on write path.
**Effort:** 1 week. **CPU reduction:** ~60%.

MediaMTX can write RTSP streams directly to disk without any decode/re-encode.
This is the most impactful single change after Phase 1. The H.264 bitstream
from DroidCam is copied byte-for-byte into MP4 files.

#### 2.1 Enable recording in mediamtx.yml

```yaml
# Add to each camera path block:

  phone1:
    source: http://192.168.137.101:4747/mjpegfeed?1280x720
    sourceOnDemand: no

    # Recording — enable per-path or globally
    record: yes
    recordPath: recordings/%path/%Y-%m-%d_%H-%M-%S-%f
    recordFormat: mp4
    recordPartDuration: 5m    # segment length: new file every 5 minutes
    recordDeleteAfter: 0      # 0 = keep forever; set "7d" to auto-delete after 7 days
```

DroidCam's MJPEG is transcoded to H.264 internally by MediaMTX before
writing. No Python code is involved in this path at all.

#### 2.2 Recording control via MediaMTX API

MediaMTX exposes a REST API on port 9997 for programmatic control.

```bash
# Start recording for a specific path
curl -X POST http://localhost:9997/v3/config/paths/phone1/record/start

# Stop recording
curl -X POST http://localhost:9997/v3/config/paths/phone1/record/stop

# List active recordings
curl http://localhost:9997/v3/recordings/list
```

#### 2.3 Update server.ts — delegate recording to MediaMTX

```typescript
// In server.ts, replace recording start/stop handlers:

const MEDIAMTX_API = "http://localhost:9997/v3";

app.post("/api/recording/start", async (_req, res) => {
  const online = cameras.filter(c => c.enabled && c.status === "online");
  const results = await Promise.all(
    online.map(cam =>
      fetch(`${MEDIAMTX_API}/config/paths/${cam.name.toLowerCase()}/record/start`, {
        method: "POST"
      }).then(r => ({ cam: cam.name, ok: r.ok }))
    )
  );
  const started = results.filter(r => r.ok).length;
  isRecording = true;
  recordingStartTime = Date.now();
  addLog("REC", `MediaMTX recording started on ${started} paths`, "success");
  res.json({ ok: true, cameras: started });
});
```

#### 2.4 Remove VideoWriter from droidgrid.py

The Python recording pipeline can now be simplified. Delete:
- `start_recording(filepath)` method body
- `stop_recording()` VideoWriter logic
- `_writer_loop()` function entirely
- `_write_q` queue
- `_writer_th` thread

Replace with a thin wrapper that calls the MediaMTX API:

```python
def start_recording(self, session_label: str) -> bool:
    """Delegate recording to MediaMTX via REST."""
    import urllib.request
    ok_count = 0
    for cam in self.cameras:
        if not cam.connected:
            continue
        try:
            path_name = cam.name.lower().replace(" ", "-").replace("_", "-")
            url = f"http://localhost:9997/v3/config/paths/{path_name}/record/start"
            req = urllib.request.Request(url, method="POST")
            urllib.request.urlopen(req, timeout=2)
            ok_count += 1
            self._log.info("Recording started: %s", cam.name)
        except Exception as e:
            self._log.warning("MediaMTX record start failed for %s: %s", cam.name, e)
    return ok_count > 0

def stop_recording(self) -> bool:
    """Stop all MediaMTX recordings."""
    import urllib.request
    for cam in self.cameras:
        try:
            path_name = cam.name.lower().replace(" ", "-").replace("_", "-")
            url = f"http://localhost:9997/v3/config/paths/{path_name}/record/stop"
            req = urllib.request.Request(url, method="POST")
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass
    return True
```

#### 2.5 File output location

```
recordings/
└── phone1/
    ├── 2025-06-07_14-30-00-000.mp4
    ├── 2025-06-07_14-35-00-000.mp4   ← 5-min segments
    └── ...
└── phone2/
    └── ...
```

For session-based naming (label/person/repeat), rename after recording stops:

```python
def rename_session_recordings(label, person, repeat, record_dir="recordings"):
    """Rename MediaMTX output files to match naming pattern."""
    import glob, os, shutil
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    for cam_dir in Path(record_dir).iterdir():
        if not cam_dir.is_dir():
            continue
        cam_name = cam_dir.name
        for mp4 in sorted(cam_dir.glob("*.mp4")):
            new_name = f"{label}_{person}_{repeat}_{cam_name}_{ts}.mp4"
            dest = Path(record_dir) / new_name
            shutil.move(str(mp4), str(dest))
```

── · ──

### §3 · Phase 3 — WebRTC Live View in Browser

**Goal:** Replace OpenCV imshow with browser-based camera grid.
**Effort:** 1–2 weeks. No new servers — MediaMTX already serves WebRTC.

MediaMTX already exposes a WebRTC endpoint at:
`http://localhost:8889/phone1`

This uses WHEP (WebRTC-HTTP Egress Protocol), which is a simple HTTP-based
signaling protocol that works directly in modern browsers with no plugin.

#### 3.1 Embed WebRTC in the React camera grid

```tsx
// src/components/CameraCell.tsx

interface CameraCellProps {
  camName: string;         // e.g. "phone1"
  mediamtxBase: string;    // e.g. "http://localhost:8889"
  isRecording: boolean;
  status: string;
}

export function CameraCell({ camName, mediamtxBase, isRecording, status }: CameraCellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const whepUrl = `${mediamtxBase}/${camName}`;

    // WHEP client — connect to MediaMTX WebRTC endpoint
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    const connect = async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const resp = await fetch(whepUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription!.sdp,
      });

      if (!resp.ok) return;
      const answer = await resp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    };

    connect().catch(console.error);
    return () => pc.close();
  }, [camName, mediamtxBase]);

  return (
    <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      {/* Status overlay, REC badge, etc. */}
    </div>
  );
}
```

#### 3.2 Update mediamtx.yml for WebRTC

```yaml
# Ensure WebRTC is enabled:
webrtcAddress: :8889
webrtcICEServers2:
  - url: stun:stun.l.google.com:19302

# Allow CORS for browser access
webrtcAdditionalHosts: []
webrtcIPsFromInterfaces: yes
```

#### 3.3 Add MEDIAMTX_BASE to API health response

```typescript
// server.ts
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    mediamtxBase: "http://localhost:8889",   // ← add this
    cameras: cameras.length,
    online: cameras.filter(c => c.status === "online").length,
    recording: isRecording,
  });
});
```

#### 3.4 Remove OpenCV imshow from droidgrid.py

Once WebRTC is working in the browser, the OpenCV window is redundant.
The Python process only needs to:
- Maintain the MediaMTX connection health checks
- Run optional motion detection / ML inference (decode only when needed)
- Report status to the API

The `_build_grid()` and `cv2.imshow()` calls can be deleted.
The capture loop still runs for inference — just without display.

── · ──

### §4 · Phase 4 — IP Camera and ONVIF Support

**Goal:** Extend DroidGrid beyond DroidCam phones to professional IP cameras.
**Effort:** 2–3 weeks.

This phase makes DroidGrid a full software-defined NVR replacement. Every
professional IP camera (Hikvision, Dahua, Axis, Reolink, Amcrest) speaks
RTSP and ONVIF. MediaMTX accepts RTSP natively — the only addition is
auto-discovery and PTZ control via the ONVIF protocol.

#### 4.1 ONVIF camera discovery

```python
# Install: pip install onvif-zeep
from onvif import ONVIFCamera

def discover_onvif_cameras(subnet="192.168.1"):
    """Scan subnet for ONVIF-compatible cameras."""
    import socket
    from wsdiscovery.discovery import ThreadedWSDiscovery

    wsd = ThreadedWSDiscovery()
    wsd.start()
    services = wsd.searchServices()
    wsd.stop()

    cameras = []
    for s in services:
        for scope in s.getScopes():
            if "onvif" in str(scope).lower():
                cameras.append({
                    "address": s.getXAddrs()[0],
                    "types": str(s.getTypes()),
                })
    return cameras

def get_rtsp_url_from_onvif(ip, port, user, password):
    """Retrieve RTSP stream URL from an ONVIF camera."""
    cam = ONVIFCamera(ip, port, user, password)
    media = cam.create_media_service()
    profiles = media.GetProfiles()
    token = profiles[0].token
    stream_uri = media.GetStreamUri({
        "StreamSetup": {"Stream": "RTP-Unicast", "Transport": "RTSP"},
        "ProfileToken": token,
    })
    return stream_uri.Uri   # e.g. rtsp://192.168.1.200:554/stream1
```

#### 4.2 Add ONVIF camera to MediaMTX config

```yaml
# mediamtx.yml — RTSP IP camera (native, no transcoding needed)
  ipcam-1:
    source: rtsp://admin:password@192.168.1.200:554/stream1
    sourceOnDemand: no
    record: yes
    recordPath: recordings/%path/%Y-%m-%d_%H-%M-%S-%f
```

#### 4.3 Add camera discovery endpoint to server.ts

```typescript
app.post("/api/cameras/discover", async (_req, res) => {
  // Run Python onvif discovery script as subprocess
  const { execFile } = require("child_process");
  execFile("python", ["scripts/discover_onvif.py"], (err, stdout) => {
    if (err) { res.json({ ok: false, error: err.message }); return; }
    try {
      const found = JSON.parse(stdout);
      res.json({ ok: true, found });
    } catch {
      res.json({ ok: false, raw: stdout });
    }
  });
});
```

#### 4.4 Storage retention policy

```typescript
// server.ts — add retention cleanup job
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS ?? "30", 10);

function pruneOldRecordings() {
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  const recordDir = session.recordDir;
  fs.readdirSync(recordDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".mp4"))
    .forEach(e => {
      const full = path.join(recordDir, e.name);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        addLog("STORAGE", `Pruned old recording: ${e.name}`, "warn");
      }
    });
}

// Run daily at 03:00
setInterval(pruneOldRecordings, 86400 * 1000);
```

---

## PART II — NFV / VNF Deployment

---

### §5 · Docker Compose VNF Stack

The proposed architecture maps cleanly to the ETSI NFV framework.
Each service is a Virtual Network Function (VNF). Docker Compose is
the VNF Descriptor (VNFD) equivalent.

#### 5.1 Full docker-compose.yml

```yaml
# docker-compose.yml — DroidGrid VNF Stack

version: "3.9"

services:

  # VNF-1: Stream Broker
  vnf-ingest:
    image: bluenviron/mediamtx:latest
    container_name: droidgrid-ingest
    network_mode: host
    volumes:
      - ./mediamtx.yml:/mediamtx.yml:ro
      - ./recordings:/recordings
    restart: unless-stopped
    deploy:
      resources:
        limits:   { cpus: "1.0",  memory: "256M" }
        reservations: { cpus: "0.2", memory: "64M" }

  # VNF-2: Recorder (FFMPEG pass-through — CPU-free)
  # Handled internally by vnf-ingest (MediaMTX record feature)
  # Separate container only needed for post-processing or tiered storage

  # VNF-3: Decoder / Inference Engine (Python + optional NVDEC)
  vnf-decoder:
    build: { context: ., dockerfile: Dockerfile.decoder }
    container_name: droidgrid-decoder
    network_mode: host
    volumes:
      - ./models:/models:ro
    environment:
      - MEDIAMTX_URL=rtsp://localhost:8554
      - INFERENCE_MODEL=/models/fern_v2.onnx
    runtime: nvidia                    # remove if no GPU
    restart: unless-stopped
    depends_on: [vnf-ingest]
    deploy:
      resources:
        limits:   { cpus: "4.0",  memory: "3G"   }
        reservations: { cpus: "0.1", memory: "512M" }

  # VNF-4: API / Control Plane
  vnf-api:
    build: { context: ., dockerfile: Dockerfile.api }
    container_name: droidgrid-api
    ports: ["3000:3000"]
    volumes:
      - ~/.droidgrid:/data
      - ./recordings:/recordings:ro
    environment:
      - DATA_DIR=/data
      - MEDIAMTX_API=http://localhost:9997
    restart: unless-stopped
    depends_on: [vnf-ingest]
    deploy:
      resources:
        limits:   { cpus: "1.0",  memory: "512M"  }
        reservations: { cpus: "0.1", memory: "128M" }

  # VNF-5: Web UI
  vnf-ui:
    build: { context: ., dockerfile: Dockerfile.ui }
    container_name: droidgrid-ui
    ports: ["80:80"]
    restart: unless-stopped
    depends_on: [vnf-api]
    deploy:
      resources:
        limits:   { cpus: "0.5",  memory: "256M"  }
        reservations: { cpus: "0.05", memory: "64M" }

networks:
  default:
    driver: bridge

volumes:
  recordings:
    driver: local
```

#### 5.2 Start the stack

```bash
# Start all VNFs
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f vnf-ingest
docker compose logs -f vnf-api

# Stop
docker compose down
```

── · ──

### §6 · Service Function Chain Configuration

```
┌─ SFC Map ─────────────────────────────────────────────────────────────────┐
│                                                                            │
│  Camera (source)                                                           │
│       │                                                                    │
│       ▼ MJPEG / RTSP                                                       │
│  ┌─────────────┐                                                           │
│  │  VNF-1      │  MediaMTX — Stream Broker                                 │
│  │  Ingest     │  · maintains camera connections                           │
│  │             │  · republishes as internal RTSP                           │
│  └──────┬──────┘  · handles reconnect automatically                       │
│         │                                                                  │
│    ┌────┴────────────────────┐                                             │
│    │                         │                                             │
│    ▼ H.264 bitstream         ▼ RTSP (for decode)                          │
│  ┌──────────┐          ┌──────────────┐                                   │
│  │  VNF-2  │          │   VNF-3      │                                    │
│  │  Record │          │   Decode     │  Python + NVDEC                    │
│  │  (disk) │          │   (on-demand)│  only when inference needed        │
│  └──────────┘          └──────┬───────┘                                   │
│                               │                                            │
│                               ▼ raw frames                                 │
│                        ┌──────────────┐                                   │
│                        │   VNF-4      │                                    │
│                        │   Analyse    │  optional: ML, motion, alerts     │
│                        │   (optional) │                                    │
│                        └──────┬───────┘                                   │
│                               │                                            │
│         ┌─────────────────────┴────────────────────┐                      │
│         │                                           │                      │
│         ▼ WebRTC / HLS                             ▼ REST / WS             │
│  ┌──────────────┐                          ┌──────────────┐               │
│  │   VNF-5     │                          │   VNF-API   │               │
│  │ Distribute  │                          │   Control   │               │
│  │ (MediaMTX)  │                          │   Plane     │               │
│  └─────────────┘                          └─────────────┘               │
│         │                                         │                        │
│         ▼                                         ▼                        │
│      Browser                               DroidGrid Pro UI                │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

Each function in the chain is independently restartable. If VNF-4 crashes,
the chain from Camera → VNF-1 → VNF-2 → VNF-5 continues unaffected.

── · ──

### §7 · Fault Isolation and Resource Descriptors

#### 7.1 Health check configuration

```yaml
# Add to each service in docker-compose.yml:

  vnf-ingest:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9997/v3/paths/list"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

  vnf-api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 15s
      timeout: 5s
      retries: 3
```

#### 7.2 Restart policy per VNF

```
  VNF            Restart policy    Rationale
  ─────────────────────────────────────────────────────────────
  vnf-ingest     unless-stopped    Core — always keep alive
  vnf-recorder   unless-stopped    Data integrity — must stay up
  vnf-decoder    on-failure:5      ML crashes ok — auto-restart
  vnf-api        unless-stopped    UI needs this
  vnf-ui         on-failure:3      Non-critical — let it fail
```

#### 7.3 NFVI resource summary (current hardware)

```
┌─ NFVI: RTX 3070 + Ryzen 7 5800H + 32 GB RAM ──────────────────────────────┐
│                                                                              │
│  Total compute available:  16 threads, 32 GB RAM, 8 GB VRAM                │
│                                                                              │
│  VNF              CPU limit    RAM limit    GPU use                         │
│  ──────────────────────────────────────────────────                         │
│  vnf-ingest       1.0 core     256 MB       none                            │
│  vnf-recorder     1.5 cores    512 MB       none (disk I/O bound)           │
│  vnf-decoder      4.0 cores    3 GB         NVDEC (free)                    │
│  vnf-analyser     4.0 cores    3 GB         CUDA inference                  │
│  vnf-api          1.0 core     512 MB       none                            │
│  vnf-ui           0.5 core     256 MB       none                            │
│  ──────────────────────────────────────────────────                         │
│  Total reserved   12.0 cores   7.5 GB                                       │
│  Headroom         4.0 cores    24.5 GB      remaining VRAM: ~6 GB           │
│                                                                              │
│  Estimated camera capacity: 10–12 at 720p/30fps simultaneously              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## PART III — Addon System Architecture

---

### §8 · Addon Interface Specification

The addon system allows third-party and internal extensions to hook into
the DroidGrid pipeline without modifying core files. An addon is a
self-contained module that declares what it does and subscribes to events.

#### 8.1 Addon manifest format

Every addon has an `addon.json` in its directory:

```json
{
  "id": "fern-inference",
  "name": "FERN Foot Gesture Recognition",
  "version": "2.0.0",
  "description": "Runs FERN v2 inference on live camera streams",
  "author": "Vision-Orchestration",
  "entry": "index.ts",
  "permissions": ["cameras.read", "recording.events", "ui.panel", "api.register"],
  "config": {
    "model_path":    { "type": "string",  "default": "./models/fern_v2.onnx" },
    "window_size":   { "type": "number",  "default": 60 },
    "confidence":    { "type": "number",  "default": 0.6 },
    "target_camera": { "type": "string",  "default": "phone1" }
  },
  "ui": {
    "panel": true,          // shows a panel in the DroidGrid Pro sidebar
    "settings": true        // adds a settings tab
  }
}
```

#### 8.2 Addon API interface (TypeScript)

```typescript
// addons/addon-api.ts — interface every addon must implement

export interface DroidGridAddon {
  id: string;

  // Called once when addon is loaded
  init(ctx: AddonContext): Promise<void>;

  // Called when a new frame arrives from a camera (optional)
  onFrame?(camId: string, frameBuffer: Buffer): void;

  // Called on recording start/stop events (optional)
  onRecordingStart?(session: SessionState): void;
  onRecordingStop?(session: SessionState, durationSec: number): void;

  // Called when addon is unloaded (cleanup)
  destroy(): Promise<void>;
}

export interface AddonContext {
  // Read camera list
  getCameras(): Camera[];

  // Register a custom REST route under /api/addons/{addonId}/...
  registerRoute(method: "GET"|"POST"|"PUT"|"DELETE", path: string, handler: Function): void;

  // Send a log message to the DroidGrid log stream
  log(msg: string, level?: "info"|"warn"|"error"|"success"): void;

  // Read/write addon-specific config (persisted to ~/.droidgrid/addons/{id}.json)
  getConfig(): Record<string, unknown>;
  setConfig(patch: Record<string, unknown>): void;

  // Emit an event to the DroidGrid event bus
  emit(event: string, data: unknown): void;

  // Subscribe to a DroidGrid event
  on(event: string, handler: (data: unknown) => void): void;
}
```

#### 8.3 Addon loader (server.ts addition)

```typescript
// server.ts — addon loading system

import fs from "fs";
import path from "path";

const ADDONS_DIR = path.join(process.cwd(), "addons");
const loadedAddons: Map<string, DroidGridAddon> = new Map();

async function loadAddons() {
  if (!fs.existsSync(ADDONS_DIR)) return;
  const dirs = fs.readdirSync(ADDONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const manifestPath = path.join(ADDONS_DIR, dir.name, "addon.json");
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entryPath = path.join(ADDONS_DIR, dir.name, manifest.entry);

    try {
      const { default: AddonClass } = await import(entryPath);
      const instance: DroidGridAddon = new AddonClass();
      await instance.init(makeAddonContext(manifest.id, app));
      loadedAddons.set(manifest.id, instance);
      addLog("ADDON", `Loaded: ${manifest.name} v${manifest.version}`, "success");
    } catch (e) {
      addLog("ADDON", `Failed to load ${dir.name}: ${e}`, "error");
    }
  }
}

// Addon management endpoints
app.get("/api/addons",              (_req, res) => res.json(getAddonList()));
app.post("/api/addons/:id/enable",  (req, res) => enableAddon(req.params.id, res));
app.post("/api/addons/:id/disable", (req, res) => disableAddon(req.params.id, res));
app.put("/api/addons/:id/config",   (req, res) => updateAddonConfig(req.params.id, req.body, res));
```

#### 8.4 Addon directory structure

```
addons/
├── fern-inference/
│   ├── addon.json
│   ├── index.ts          ← main entry, exports default class
│   ├── inference.py      ← Python subprocess for ONNX inference
│   └── README.md
├── motion-alert/
│   ├── addon.json
│   └── index.ts
└── data-logger/
    ├── addon.json
    └── index.ts
```

── · ──

### §9 · Built-in Addon Catalogue

```
┌─ Planned Addons ────────────────────────────────────────────────────────────┐
│                                                                              │
│  ID                  Status    Description                                   │
│  ──────────────────────────────────────────────────────────────────────     │
│  fern-inference      ○ plan    FERN foot gesture recognition on live feed   │
│  motion-alert        ○ plan    Motion detection + webhook notification       │
│  data-logger         ○ plan    Log gesture events to CSV / SQLite            │
│  snapshot-trigger    ○ plan    Auto-snapshot on gesture detection            │
│  obs-overlay         ○ plan    Send gesture labels to OBS via WebSocket      │
│  hid-emulator        ○ plan    Map gestures to keyboard/mouse HID events     │
│  mediapipe-live      ○ plan    Draw skeleton overlay on live video frames    │
│  clip-extractor      ○ plan    Auto-clip N seconds around detected gesture   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## PART IV — FERN Integration

---

### §10 · FERN as DroidGrid Addon

FERN is the first first-party addon. It consumes live RTSP frames from
MediaMTX, runs MediaPipe skeleton extraction, feeds the 10-joint skeleton
through the FERN v2 ONNX model, and emits gesture events to the DroidGrid
event bus.

#### 10.1 addon.json

```json
{
  "id": "fern-inference",
  "name": "FERN Foot Gesture Recognition",
  "version": "2.0.0",
  "entry": "index.ts",
  "permissions": ["cameras.read", "recording.events", "ui.panel", "api.register"],
  "config": {
    "model_path":     { "type": "string",  "default": "./models/fern_v2.onnx" },
    "mediapipe_task": { "type": "string",  "default": "./models/pose_landmarker_heavy.task" },
    "target_camera":  { "type": "string",  "default": "phone1" },
    "n_cameras":      { "type": "number",  "default": 1 },
    "camera_id":      { "type": "number",  "default": 0 },
    "window_size":    { "type": "number",  "default": 60 },
    "stride":         { "type": "number",  "default": 15 },
    "confidence":     { "type": "number",  "default": 0.6 },
    "smoothing_n":    { "type": "number",  "default": 5 }
  }
}
```

#### 10.2 index.ts — spawn Python subprocess

```typescript
// addons/fern-inference/index.ts

import { spawn, ChildProcess } from "child_process";
import type { DroidGridAddon, AddonContext } from "../addon-api";

export default class FernInferenceAddon implements DroidGridAddon {
  id = "fern-inference";
  private ctx!: AddonContext;
  private proc: ChildProcess | null = null;

  async init(ctx: AddonContext) {
    this.ctx = ctx;
    ctx.log("FERN inference addon initialised", "success");
    ctx.registerRoute("GET", "/status", (_req, res) => {
      res.json({ running: !!this.proc, pid: this.proc?.pid });
    });
    ctx.registerRoute("POST", "/start", (_req, res) => {
      this.startInference();
      res.json({ ok: true });
    });
    ctx.registerRoute("POST", "/stop", (_req, res) => {
      this.stopInference();
      res.json({ ok: true });
    });
  }

  private startInference() {
    if (this.proc) return;
    const cfg = this.ctx.getConfig();
    this.proc = spawn("python", [
      "addons/fern-inference/inference.py",
      "--model",        String(cfg.model_path),
      "--mediapipe",    String(cfg.mediapipe_task),
      "--rtsp_url",     `rtsp://localhost:8554/${cfg.target_camera}`,
      "--n_cameras",    String(cfg.n_cameras),
      "--camera_id",    String(cfg.camera_id),
      "--window_size",  String(cfg.window_size),
      "--confidence",   String(cfg.confidence),
      "--smoothing_n",  String(cfg.smoothing_n),
    ]);

    this.proc.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          this.ctx.emit("fern:gesture", event);
          this.ctx.log(`Gesture: ${event.gesture} (${(event.confidence*100).toFixed(0)}%)`,
                       "success");
        } catch { /* non-JSON stdout, ignore */ }
      }
    });

    this.proc.on("exit", (code) => {
      this.ctx.log(`Inference process exited: ${code}`, code === 0 ? "info" : "warn");
      this.proc = null;
    });
  }

  private stopInference() {
    this.proc?.kill("SIGTERM");
    this.proc = null;
  }

  async destroy() {
    this.stopInference();
  }
}
```

── · ──

### §11 · Stream → Inference Pipeline

#### 11.1 inference.py — full inference loop

```python
#!/usr/bin/env python3
"""
addons/fern-inference/inference.py
Reads RTSP stream from MediaMTX, runs MediaPipe + FERN v2 ONNX, emits JSON events.
"""
import argparse, sys, json, time, collections
import cv2, numpy as np

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--model",       required=True)
    p.add_argument("--mediapipe",   required=True)
    p.add_argument("--rtsp_url",    required=True)
    p.add_argument("--n_cameras",   type=int, default=1)
    p.add_argument("--camera_id",   type=int, default=0)
    p.add_argument("--window_size", type=int, default=60)
    p.add_argument("--confidence",  type=float, default=0.6)
    p.add_argument("--smoothing_n", type=int, default=5)
    return p.parse_args()

LOWER_BODY_INDICES = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]

CLASSES = [
    "foot_hold", "foot_lift", "sideway_kick", "cross_front",
    "heel_tap", "flamingo_bend", "forward_step", "forward_kick"
]

def extract_lower_body(landmarks, image_w, image_h):
    """Extract 10 lower-body joints: x, y, z per joint → 30 values."""
    row = []
    for idx in LOWER_BODY_INDICES:
        lm = landmarks[idx]
        row.extend([lm.x, lm.y, lm.z])
    return row

def normalise(frame_features, hip_idx=0):
    """Torso-relative normalisation: subtract hip midpoint, scale by torso."""
    arr = np.array(frame_features, dtype=np.float32).reshape(10, 3)
    # hip midpoint
    hip_mid = (arr[0] + arr[1]) / 2.0
    arr -= hip_mid
    # scale by max extent
    scale = np.linalg.norm(arr, axis=1).max()
    if scale > 1e-6:
        arr /= scale
    return arr.flatten().tolist()

def run(args):
    import onnxruntime as ort
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    # Load ONNX model
    sess = ort.InferenceSession(
        args.model,
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    input_name = sess.get_inputs()[0].name
    expected_features = 30 + args.n_cameras

    # Load MediaPipe
    base_options = mp_python.BaseOptions(model_asset_path=args.mediapipe)
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1,
    )
    detector = mp_vision.PoseLandmarker.create_from_options(options)

    # Open RTSP stream
    cap = cv2.VideoCapture(args.rtsp_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    frame_buf = collections.deque(maxlen=args.window_size)
    vote_buf  = collections.deque(maxlen=args.smoothing_n)
    frame_idx = 0

    # Camera one-hot flag
    one_hot = [0] * args.n_cameras
    if 0 <= args.camera_id < args.n_cameras:
        one_hot[args.camera_id] = 1

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.033)
            continue

        # MediaPipe detection
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = detector.detect_for_video(mp_img, int(frame_idx * 33.33))
        frame_idx += 1

        if not result.pose_landmarks:
            continue

        raw = extract_lower_body(result.pose_landmarks[0], frame.shape[1], frame.shape[0])
        normalised = normalise(raw)
        flagged = normalised + one_hot           # append camera one-hot
        frame_buf.append(flagged)

        if len(frame_buf) < args.window_size:
            continue

        # Run inference
        window = np.array(list(frame_buf), dtype=np.float32)[None]   # (1, T, F)
        logits = sess.run(None, {input_name: window})[0][0]
        probs  = np.exp(logits) / np.exp(logits).sum()
        pred   = int(probs.argmax())
        conf   = float(probs[pred])

        vote_buf.append(pred)
        smoothed = collections.Counter(vote_buf).most_common(1)[0][0]

        if conf >= args.confidence:
            event = {
                "gesture":    CLASSES[smoothed],
                "confidence": conf,
                "raw_pred":   CLASSES[pred],
                "probs":      probs.tolist(),
                "timestamp":  time.time(),
            }
            print(json.dumps(event), flush=True)

    cap.release()
    detector.close()

if __name__ == "__main__":
    run(parse_args())
```

── · ──

### §12 · Recording Assistant Integration

The existing `recording_assistant.py` (tkinter fullscreen tool) can be
connected to DroidGrid Pro via its REST API instead of running standalone.

#### 12.1 Replace standalone recording with API calls

```python
# recording_assistant.py — replace direct VideoCapture recording with API calls

import urllib.request, json

DROIDGRID_API = "http://localhost:3000"

def api_call(endpoint: str, method: str = "POST", body: dict = None) -> dict:
    url  = f"{DROIDGRID_API}{endpoint}"
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, method=method,
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"ok": False, "error": str(e)}

def start_droidgrid_recording(label: str, person: str, repeat: str) -> bool:
    r1 = api_call("/api/session", "PUT", {
        "label": label, "person": person, "repeat": repeat
    })
    r2 = api_call("/api/recording/start")
    return r2.get("ok", False)

def stop_droidgrid_recording() -> bool:
    r = api_call("/api/recording/stop")
    return r.get("ok", False)
```

---

## PART V — FERN: Alpha Phase Tasks

---

### §13 · Current Data State and Directory Map

```
┌─ C:\fern\FERN_V2\data\ ────────────────────────────────────────────────────┐
│                                                                              │
│  skeletons/                                                                  │
│  ├── front/          76 CSVs  (38 c3 orig + 38 mirror)   camera_id=0  ✓    │
│  ├── raw_45/         22 CSVs  (c2 originals, z non-zero) camera_id=2  ✓    │
│  ├── merged_v1/      50 CSVs  (c3+c4, partial)            mixed       !    │
│  ├── c4/             TBD      (copy from merged_v1)        camera_id=1 ○    │
│  ├── flagged_p1/     TBD      (c3 + c4 combined)           n=2         ○    │
│  └── flagged_p2/     TBD      (c3 + c4 + c2 combined)      n=3         ○    │
│                                                                              │
│  labels/                                                                     │
│  ├── front/          76 JSONs  camera_id=0 added           ✓               │
│  ├── raw_45/         22 JSONs  camera_id=2 added           ✓               │
│  ├── merged_v1/      50 JSONs  camera_id by filename       !               │
│  ├── c4/             TBD                                   ○               │
│  ├── flagged_p1/     TBD                                   ○               │
│  └── flagged_p2/     TBD                                   ○               │
│                                                                              │
│  ✓ done   ! needs verification   ○ not created yet                          │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

```
┌─ Environment ───────────────────────────────────────────────────────────────┐
│  Root:       C:\fern\FERN_V2\                                                │
│  Venv:       C:\fern\FERN_V2\venv\   (moved from FERN_complete)             │
│  PYTHONPATH: C:\fern\FERN_V2\src                                            │
│  Shell:      PowerShell only                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 13.1 Environment activation

```powershell
cd C:\fern\FERN_V2
$env:PYTHONPATH = "C:\fern\FERN_V2\src"
.\venv\Scripts\Activate.ps1
```

── · ──

### §14 · Camera-ID Flag Experiment

#### Phase 1 — c3 + c4  (input dim: T × 32)

```
  Camera encoding:
  ─────────────────────────────────
  c3  front  0°    →  [1, 0]
  c4  right  45°   →  [0, 1]
```

**Step 0 — Check if c4 skeletons exist:**

```powershell
Get-ChildItem data\skeletons\merged_v1\*c4*.csv 2>$null | Measure-Object | Select Count
# If Count == 11 → skip to Step 2
# If Count < 11  → run Step 1
```

**Step 1 — Extract c4 skeletons (run only if needed):**

```powershell
python src\extract_skeleton.py `
    --video_dir  data\merged_v1 `
    --output_dir data\skeletons\merged_v1
# Runtime: ~2-4 hours for all merged_v1 videos
```

**Step 2 — Check c4 detection rates:**

```powershell
python - << 'EOF'
import pandas as pd
from pathlib import Path

skel_dir = Path("data/skeletons/merged_v1")
c4_files = sorted(skel_dir.glob("*c4*.csv"))
keep, skip = [], []

for f in c4_files:
    df = pd.read_csv(f)
    if "pose_detected" not in df.columns:
        keep.append(f.stem); continue
    pct = 100 * df["pose_detected"].sum() / max(len(df), 1)
    tag = "OK  " if pct >= 60 else "SKIP"
    print(f"  {tag}  {f.name:25s}  {pct:5.1f}%")
    (keep if pct >= 60 else skip).append(f.stem)

print(f"\nKeep: {len(keep)}   Skip: {len(skip)}")
print(f"Skipped: {skip}")
EOF
```

**Step 3 — Stamp camera_id into all label JSONs:**

```powershell
python - << 'EOF'
import json
from pathlib import Path

def stamp(label_dir, cam_id, pattern="*.json"):
    dir_ = Path(label_dir)
    n = 0
    for f in dir_.glob(pattern):
        d = json.loads(f.read_text())
        if "camera_id" not in d:
            d["camera_id"] = cam_id
            f.write_text(json.dumps(d, indent=2))
            n += 1
    print(f"  {label_dir}: {n} files stamped → camera_id={cam_id}")

stamp("data/labels/front",   camera_id=0)
stamp("data/labels/raw_45",  camera_id=2)

for f in Path("data/labels/merged_v1").glob("*.json"):
    d = json.loads(f.read_text())
    if "camera_id" in d: continue
    stem = f.stem
    cam_id = 0 if "_c3" in stem else 1 if "_c4" in stem else 2 if "_c2" in stem else -1
    d["camera_id"] = cam_id
    f.write_text(json.dumps(d, indent=2))
print("  merged_v1 labels: stamped")
EOF
```

**Step 4 — Build c4 directory (copy passing files only):**

```powershell
New-Item -ItemType Directory -Force data\skeletons\c4, data\labels\c4

# Replace list below with actual passing stems from Step 2
$keep = @("p00_c4","p01_c4","p02_c4","p03_c4","p05_c4",
          "p06_c4","p07_c4","p08_c4","p09_c4","p10_c4","p11_c4")

foreach ($stem in $keep) {
    $csv  = "data\skeletons\merged_v1\$stem.csv"
    $json = "data\labels\merged_v1\$stem.json"
    if (Test-Path $csv)  { Copy-Item $csv  data\skeletons\c4\ }
    if (Test-Path $json) { Copy-Item $json data\labels\c4\ }
}
$s = (Get-ChildItem data\skeletons\c4\*.csv).Count
$l = (Get-ChildItem data\labels\c4\*.json).Count
Write-Host "c4: $s skeletons  $l labels  (must be equal)"
```

**Step 5 — Mirror c4:**

```powershell
python src\mirror_10joint.py `
    --skeleton_dir data\skeletons\c4 `
    --label_dir    data\labels\c4 `
    --output_skel  data\skeletons\c4 `
    --output_label data\labels\c4

$total = (Get-ChildItem data\skeletons\c4\*.csv).Count
Write-Host "After mirror: $total CSVs (should be 2x original count)"
```

**Step 6 — Assemble Phase 1 dataset:**

```powershell
New-Item -ItemType Directory -Force data\skeletons\flagged_p1, data\labels\flagged_p1

# c3 data (camera_id=0)
Copy-Item data\skeletons\front\*.csv   data\skeletons\flagged_p1\
Copy-Item data\labels\front\*.json    data\labels\flagged_p1\

# c4 data (camera_id=1, includes mirrors)
Copy-Item data\skeletons\c4\*.csv     data\skeletons\flagged_p1\
Copy-Item data\labels\c4\*.json      data\labels\flagged_p1\

$s = (Get-ChildItem data\skeletons\flagged_p1\*.csv).Count
$l = (Get-ChildItem data\labels\flagged_p1\*.json).Count
Write-Host "Phase 1 dataset: $s skeletons  $l labels"
```

**Step 7 — Modify dataset_v2.py:**

Add `n_cameras` parameter. After reading a window's features (30 values),
append the camera one-hot flag:

```python
# In dataset_v2.py — __init__
def __init__(self, ..., n_cameras: int = 1):
    self.n_cameras = n_cameras
    ...
    # Load camera_id from JSON
    with open(label_path) as f:
        label_data = json.load(f)
    self.cam_id = label_data.get("camera_id", 0)

# In __getitem__ — after extracting window features
one_hot = [0] * self.n_cameras
if 0 <= self.cam_id < self.n_cameras:
    one_hot[self.cam_id] = 1

# Append one_hot to each frame in the window
window = window.copy()                     # (T, 30)
flag   = np.array(one_hot, dtype=np.float32)
flag_repeated = np.tile(flag, (len(window), 1))  # (T, n_cameras)
window = np.concatenate([window, flag_repeated], axis=1)  # (T, 30+n_cameras)
```

**Step 8 — Modify model_v2.py:**

Replace hardcoded `30` with `input_features` parameter:

```python
class FERNModel(nn.Module):
    def __init__(self, input_features: int = 30, ...):
        super().__init__()
        self.input_features = input_features
        # Replace all occurrences of hardcoded 30 with self.input_features
        self.cnn = nn.Sequential(
            nn.Conv1d(input_features, cnn_out, kernel_size=3, padding=1),
            ...
        )
```

**Step 9 — Modify train_v2.py:**

```python
# Add argument
parser.add_argument("--n_cameras", type=int, default=1)

# Compute input features
input_features = 30 + args.n_cameras

# Pass to dataset and model
dataset = SkeletonWindowDataset(..., n_cameras=args.n_cameras)
model   = FERNModel(input_features=input_features, ...)
```

**Step 10 — Train Phase 1:**

```powershell
python src\train_v2.py `
    --skeleton_dir  data\skeletons\flagged_p1 `
    --label_dir     data\labels\flagged_p1 `
    --output_dir    models_flagged_p1 `
    --log_dir       logs_flagged_p1 `
    --epochs        200 `
    --warmup_epochs 20 `
    --batch_size    32 `
    --window_size   60 `
    --stride        15 `
    --lr            3e-4 `
    --weight_decay  1e-2 `
    --dropout       0.6 `
    --cnn_out       64 `
    --lstm_hidden   0 `
    --lstm_layers   1 `
    --n_cameras     2 `
    --patience      40 `
    --device        cuda `
    --num_workers   4 `
    2>&1 | Tee-Object logs_flagged_p1\train_log.txt
```

**Step 11 — Export ONNX:**

```powershell
python src\export_onnx.py `
    --checkpoint models_flagged_p1\fern_v2_best.pth `
    --output     models_flagged_p1\fern_v2.onnx `
    --n_cameras  2
```

#### Phase 2 — Add c2  (input dim: T × 33)

```
  Camera encoding:
  ─────────────────────────────────
  c3  front  0°    →  [1, 0, 0]
  c4  right  45°   →  [0, 1, 0]
  c2  left   90°   →  [0, 0, 1]
```

Only run if Phase 1 c4 accuracy >= 50%.

```powershell
# Mirror c2 if not already done
$n = (Get-ChildItem data\skeletons\raw_45\*_mirror.csv 2>$null).Count
if ($n -eq 0) {
    python src\mirror_10joint.py `
        --skeleton_dir data\skeletons\raw_45 `
        --label_dir    data\labels\raw_45 `
        --output_skel  data\skeletons\raw_45 `
        --output_label data\labels\raw_45
}

# Assemble Phase 2 dataset
New-Item -ItemType Directory -Force data\skeletons\flagged_p2, data\labels\flagged_p2
Copy-Item data\skeletons\flagged_p1\*.csv  data\skeletons\flagged_p2\
Copy-Item data\labels\flagged_p1\*.json   data\labels\flagged_p2\
Copy-Item data\skeletons\raw_45\*.csv     data\skeletons\flagged_p2\
Copy-Item data\labels\raw_45\*.json      data\labels\flagged_p2\

# Train Phase 2
python src\train_v2.py `
    --skeleton_dir  data\skeletons\flagged_p2 `
    --label_dir     data\labels\flagged_p2 `
    --output_dir    models_flagged_p2 `
    --log_dir       logs_flagged_p2 `
    --epochs        200 `
    --warmup_epochs 20 `
    --batch_size    32 `
    --n_cameras     3 `
    --patience      40 `
    --device        cuda `
    --num_workers   4 `
    2>&1 | Tee-Object logs_flagged_p2\train_log.txt
```

── · ──

### §15 · Alpha Phase Tasks (non-camera-flag)

```
┌─ Alpha Backlog ─────────────────────────────────────────────────────────────┐
│                                                                              │
│  Priority  Task                                Status                        │
│  ──────────────────────────────────────────────────────────────             │
│  1         LR mirror new database              ✓ done (mirror_10joint.py)   │
│  2         Idle class recording                ○ not started                 │
│  3         Merge FERN v1 clips                 ! partial (p02_c1 fails)     │
│  4         Window offset fix                   ○ not started                 │
│  5         Subject-independent eval            ○ not started                 │
│  6         CUDA utilisation probe              ○ not started                 │
│  7         Camera-ID flag (Phase 1)            ○ active — see §14           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 15.1 Idle class

```powershell
# Record 20 subjects doing nothing — standing still, natural posture
# Use recording_assistant.py or manual DroidCam recording
# Filename convention: idle_p20_c3_r01.mp4 ... idle_p39_c3_r10.mp4

# After recording, extract skeletons:
python src\extract_skeleton.py `
    --video_dir  data\idle_videos `
    --output_dir data\skeletons\idle

# Add class "idle" to DEFAULT_CLASSES in dataset_v2.py (class index 0)
# Shift existing class indices by 1
# Retrain all models after adding idle class
```

#### 15.2 Window offset fix

```python
# In dataset_v2.py, shift window start:
# Currently: window covers frames [onset ... onset+window_size]
# Problem: window starts too late — gesture is already midway through
# Fix: shift start by ~15 frames earlier

WINDOW_OFFSET = -15   # frames to shift window start (negative = earlier)

# In the window-building loop:
start = max(0, gesture_start + WINDOW_OFFSET)
end   = start + window_size
```

#### 15.3 Subject-independent evaluation

```python
# In train_v2.py or evaluate_v2.py — leave-one-subject-out cross-validation

from sklearn.model_selection import LeaveOneGroupOut

subjects = [path.stem.split("_")[0] for path in skeleton_dir.glob("*.csv")]
logo = LeaveOneGroupOut()

results = []
for train_idx, test_idx in logo.split(X, y, groups=subjects):
    # Train on all subjects except one, test on held-out subject
    ...
    results.append(test_accuracy)

print(f"LOSO mean accuracy: {np.mean(results):.3f} ± {np.std(results):.3f}")
```

#### 15.4 CUDA utilisation probe

```powershell
# During training, in a separate PowerShell window:
nvidia-smi dmon -s u -d 2
# Watch SM% — should be > 70% during training
# If < 30%, bottleneck is DataLoader (increase num_workers or batch_size)

# Check DataLoader speed:
python - << 'EOF'
import time
from torch.utils.data import DataLoader
from dataset_v2 import SkeletonWindowDataset

ds = SkeletonWindowDataset("data/skeletons/front", "data/labels/front",
                            window_size=60, stride=15)
loader = DataLoader(ds, batch_size=32, num_workers=4, pin_memory=True)
t0 = time.time()
for i, (x, y) in enumerate(loader):
    if i == 20: break
print(f"20 batches in {time.time()-t0:.2f}s = {(time.time()-t0)/20*1000:.0f}ms/batch")
EOF
```

── · ──

### §16 · Training Commands Reference

#### 16.1 Standard c3-only baseline

```powershell
python src\train_v2.py `
    --skeleton_dir data\skeletons\front `
    --label_dir    data\labels\front `
    --output_dir   models `
    --log_dir      logs `
    --epochs       100 `
    --warmup_epochs 10 `
    --batch_size   32 `
    --window_size  60 `
    --stride       15 `
    --lr           3e-4 `
    --device       cuda `
    --num_workers  4
```

#### 16.2 merged_v1 dataset

```powershell
python src\train_v2.py `
    --skeleton_dir data\skeletons\merged_v1 `
    --label_dir    data\labels\merged_v1 `
    --output_dir   models_merged `
    --log_dir      logs_merged `
    --epochs       100 `
    --batch_size   32 `
    --device       cuda `
    --num_workers  4
```

#### 16.3 Quick test run (CPU, 2 epochs)

```powershell
python src\train_v2.py `
    --skeleton_dir data\skeletons\front `
    --label_dir    data\labels\front `
    --output_dir   models_test `
    --log_dir      logs_test `
    --epochs       2 `
    --batch_size   16 `
    --device       cpu `
    --num_workers  0
# Runtime: ~96s. Validates pipeline without using GPU.
```

#### 16.4 ONNX export

```powershell
python src\export_onnx.py `
    --checkpoint models\fern_v2_best.pth `
    --output     models_final\fern_v2.onnx
```

#### 16.5 Live inference (DroidCam via DroidX / virtual webcam)

```powershell
python src\infer_v2.py `
    --model        models_final\fern_v2.onnx `
    --mediapipe    models\pose_landmarker_heavy.task `
    --camera       0 `
    --window_size  60 `
    --confidence   0.6
```

#### 16.6 Re-run v1 merge (fix p02_c1)

```powershell
python src\merge_v1_db.py `
    --v1_dir    data\v1_clips `
    --output_dir data\merged_v1
# Known failure: p02_c1 (51 clips with mixed resolutions from MOV conversions)
# All other groups succeed.
```

── · ──

### §17 · Success Criteria and Evaluation

#### Phase 1 camera-flag thresholds

```
  Metric                          Target    Meaning if below target
  ─────────────────────────────────────────────────────────────────────────
  Phase 1 c3 accuracy             ≥ 65%     Flag corrupted front-view learning
  Phase 1 c4 accuracy             ≥ 55%     Flag not helping 45° view
  Phase 2 c2 accuracy             ≥ 45%     90° view too hard for current arch
  Phase 2 c3 accuracy             ≥ 60%     Adding c2 hurt front accuracy
```

#### Final comparison table (run after all phases)

```powershell
python - << 'EOF'
import sys, numpy as np
sys.path.insert(0, "src")
import onnxruntime as ort
from dataset_v2 import SkeletonWindowDataset, DEFAULT_CLASSES

def eval(model_path, skel_dir, label_dir, n_cams):
    try:
        sess = ort.InferenceSession(model_path, providers=["CUDAExecutionProvider","CPUExecutionProvider"])
    except: return None
    name = sess.get_inputs()[0].name
    ds = SkeletonWindowDataset(skel_dir, label_dir, window_size=60, stride=15,
                                split="all", augment=False, n_cameras=n_cams)
    if not len(ds): return None
    nc = len(DEFAULT_CLASSES)
    cc = np.zeros(nc, int); ct = np.zeros(nc, int)
    for x, y in ds:
        pred = int(np.argmax(sess.run(None, {name: x.numpy().astype("float32")[None]})[0]))
        ct[y] += 1
        if pred == y: cc[y] += 1
    return cc.sum()/ct.sum(), cc, ct

rows = [
    ("Baseline c3-only",     "models_final/fern_v2.onnx",          "data/skeletons/front",    "data/labels/front",    1),
    ("Phase1 flag / c3",     "models_flagged_p1/fern_v2_best.onnx","data/skeletons/front",    "data/labels/front",    2),
    ("Phase1 flag / c4",     "models_flagged_p1/fern_v2_best.onnx","data/skeletons/c4",       "data/labels/c4",       2),
    ("Phase2 flag / c3",     "models_flagged_p2/fern_v2_best.onnx","data/skeletons/front",    "data/labels/front",    3),
    ("Phase2 flag / c4",     "models_flagged_p2/fern_v2_best.onnx","data/skeletons/c4",       "data/labels/c4",       3),
    ("Phase2 flag / c2",     "models_flagged_p2/fern_v2_best.onnx","data/skeletons/raw_45",   "data/labels/raw_45",   3),
]

print()
print(f"  {'Model':<30} {'Acc':>8} {'N':>7}")
print("  " + "─"*48)
for name, model, skel, label, nc in rows:
    r = eval(model, skel, label, nc)
    if r: print(f"  {name:<30} {r[0]*100:>7.2f}% {r[2].sum():>7}")
    else: print(f"  {name:<30}   (missing)")
print()
EOF
```

#### Critical implementation notes

```
┌─ Do Not Forget ─────────────────────────────────────────────────────────────┐
│                                                                              │
│  1. Default n_cameras=1 must leave model behaviour identical to v2          │
│     baseline. Old .onnx files must work without modification.               │
│                                                                              │
│  2. cam_ids array must be aligned with windows array at all times.          │
│     Any filter or shuffle applied to windows must also apply to cam_ids.    │
│     Off-by-one here silently corrupts training.                             │
│                                                                              │
│  3. Mirror files inherit the SAME camera_id as their original.              │
│     Verify: all *_mirror.json must match camera_id of non-mirror JSON.      │
│                                                                              │
│  4. Do NOT resume from existing checkpoint after changing n_cameras.        │
│     input_features changed (30→32→33), weights are incompatible.           │
│     Always train from scratch for each phase.                               │
│                                                                              │
│  5. Early stopping must be disabled until after warmup_epochs.              │
│     Track val_acc (not val_loss) for the patience counter.                  │
│     Bug was confirmed: old code triggered early stop at epoch 16.           │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

```
 main ─ Vision-Orchestration ─ DroidGrid + FERN ─ rev 2025-06-07
```
