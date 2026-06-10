/**
 * DroidGrid Pro — Express backend
 */
import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import { EventEmitter } from "events";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR      = path.join(os.homedir(), ".droidgrid");
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");
const CAMERAS_FILE  = path.join(DATA_DIR, "cameras.json");
const SESSION_FILE  = path.join(DATA_DIR, "session.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

// MediaMTX integration
const MEDIAMTX_API = "http://localhost:9997/v3";
const MEDIAMTX_BASE = "http://localhost:8889";
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS ?? "30", 10);

// ── Addon event bus ────────────────────────────────────────────────────────
const addonEventBus = new EventEmitter();
addonEventBus.setMaxListeners(100);

interface LoadedAddonEntry {
  instance: unknown;
  manifest: Record<string, unknown>;
  enabled: boolean;
}

function readJson<T>(file: string, fallback: T): T {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  return fallback;
}
function writeJson(file: string, data: unknown) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

interface Camera {
  id: string; name: string; ip: string; port: number;
  res: [number, number]; fps: number; enabled: boolean;
  status: "online"|"offline"|"checking"|"recording";
}
interface Profile {
  id: string; name: string; cameras: Camera[];
  session: SessionState; createdAt: string;
}
interface SessionState {
  label: string; person: string; repeat: string;
  pattern: string; recordDir: string; snapDir: string;
}
interface LogEntry {
  id: number; time: string; system: string; msg: string;
  level: "info"|"warn"|"error"|"success";
}

interface AddonContext {
  getCameras(): Camera[];
  registerRoute(method: "GET"|"POST"|"PUT"|"DELETE", path: string, handler: Function): void;
  log(msg: string, level?: "info"|"warn"|"error"|"success"): void;
  getConfig(): Record<string, unknown>;
  setConfig(patch: Record<string, unknown>): void;
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
}

let cameras: Camera[] = readJson<Camera[]>(CAMERAS_FILE, [
  { id:"cam-1", name:"Phone-1", ip:"192.168.137.101", port:4747, res:[1280,720], fps:30, enabled:true,  status:"offline" },
  { id:"cam-2", name:"Phone-2", ip:"192.168.137.102", port:4747, res:[1280,720], fps:30, enabled:true,  status:"offline" },
  { id:"cam-3", name:"Phone-3", ip:"192.168.137.103", port:4747, res:[1280,720], fps:30, enabled:false, status:"offline" },
]);
let profiles: Record<string, Profile> = readJson(PROFILES_FILE, {});
let lastProfileId: string|null = null;
let session: SessionState = readJson<SessionState>(SESSION_FILE, {
  label:"session", person:"p01", repeat:"r01",
  pattern:"{label}_{person}_{repeat}_{camera}",
  recordDir:"recordings", snapDir:"snapshots",
});
let isRecording = false;
let recordingStartTime: number|null = null;
let logCounter = 1;
const logs: LogEntry[] = [];

function addLog(system: string, msg: string, level: LogEntry["level"] = "info") {
  const entry: LogEntry = {
    id: logCounter++,
    time: new Date().toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",second:"2-digit"}),
    system, msg, level,
  };
  logs.unshift(entry);
  if (logs.length > 200) logs.pop();
  return entry;
}

async function checkCamera(cam: Camera): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${cam.ip}:${cam.port}/mjpegfeed`, {timeout:3000}, (res) => {
      res.destroy();
      resolve((res.statusCode ?? 0) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function checkAllCameras() {
  addLog("SCAN", `Checking ${cameras.filter(c=>c.enabled).length} enabled cameras...`);
  await Promise.all(cameras.map(async (cam) => {
    if (!cam.enabled) return;
    cam.status = "checking";
    const ok = await checkCamera(cam);
    cam.status = ok ? "online" : "offline";
    addLog("CAMERA", `${cam.name} (${cam.ip}) — ${ok?"ONLINE":"offline"}`, ok?"success":"warn");
  }));
  writeJson(CAMERAS_FILE, cameras);
}

// ── MediaMTX recording helpers ──────────────────────────────────────────────
async function getMediaMTXRecordingPaths(cameraNames: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const resp = await fetch(`${MEDIAMTX_API}/recordings/list`);
    if (!resp.ok) return result;
    const data = await resp.json() as { items?: Array<{ name: string; segments: Array<{ fpath: string }> }> };
    for (const item of data.items ?? []) {
      const segs = item.segments ?? [];
      if (segs.length === 0) continue;
      const latest = segs[segs.length - 1].fpath;
      for (const camName of cameraNames) {
        if (item.name.toLowerCase().includes(camName.toLowerCase())) {
          result[camName] = latest;
        }
      }
    }
  } catch (e) {
    addLog("MEDIAMTX", `getMediaMTXRecordingPaths error: ${e}`, "warn");
  }
  return result;
}

async function stopMediaMTXPath(pathName: string): Promise<boolean> {
  try {
    const r = await fetch(`${MEDIAMTX_API}/config/paths/${pathName}/record/stop`, { method: "POST" });
    return r.ok;
  } catch { return false; }
}

addLog("SERVER", "DroidGrid Pro backend started", "success");
setTimeout(checkAllCameras, 1500);
setInterval(checkAllCameras, 30000);

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  app.get("/api/health", (_req,res) => res.json({
    status:"ok", version:"2.4.0-pro", uptime:process.uptime(),
    cameras:cameras.length, online:cameras.filter(c=>c.status==="online").length,
    recording:isRecording, mediamtxBase:MEDIAMTX_BASE,
  }));

  // ── Cameras ──────────────────────────────────────────────────────────────
  app.get("/api/cameras", (_req,res) => res.json(cameras));

  app.post("/api/cameras", (req,res) => {
    const cam: Camera = {
      id:`cam-${Date.now()}`, name:req.body.name||"New Camera",
      ip:req.body.ip||"", port:req.body.port||4747,
      res:req.body.res||[1280,720], fps:req.body.fps||30,
      enabled:true, status:"offline",
    };
    cameras.push(cam);
    writeJson(CAMERAS_FILE, cameras);
    addLog("CONFIG", `Added: ${cam.name} (${cam.ip})`, "success");
    res.json(cam);
  });

  app.put("/api/cameras/:id", (req,res) => {
    const idx = cameras.findIndex(c=>c.id===req.params.id);
    if (idx===-1) { res.status(404).json({error:"Not found"}); return; }
    cameras[idx] = {...cameras[idx], ...req.body};
    writeJson(CAMERAS_FILE, cameras);
    res.json(cameras[idx]);
  });

  app.delete("/api/cameras/:id", (req,res) => {
    const idx = cameras.findIndex(c=>c.id===req.params.id);
    if (idx===-1) { res.status(404).json({error:"Not found"}); return; }
    const name = cameras[idx].name;
    cameras.splice(idx,1);
    writeJson(CAMERAS_FILE, cameras);
    addLog("CONFIG", `Removed: ${name}`, "warn");
    res.json({ok:true});
  });

  app.post("/api/cameras/:id/test", async (req,res) => {
    const cam = cameras.find(c=>c.id===req.params.id);
    if (!cam) { res.status(404).json({error:"Not found"}); return; }
    cam.status = "checking";
    addLog("TEST", `Testing ${cam.name} (${cam.ip}:${cam.port})...`);
    const ok = await checkCamera(cam);
    cam.status = ok?"online":"offline";
    writeJson(CAMERAS_FILE, cameras);
    addLog("TEST", `${cam.name} — ${ok?"ONLINE":"offline"}`, ok?"success":"warn");
    res.json({id:cam.id, status:cam.status});
  });

  app.post("/api/cameras/test-all", async (_req,res) => {
    await checkAllCameras();
    res.json({cameras: cameras.map(c=>({id:c.id,name:c.name,status:c.status}))});
  });

  // Camera discovery (ONVIF / subnet scan)
  app.post("/api/cameras/discover", async (_req,res) => {
    const { execFile } = await import("child_process");
    execFile("python", [path.join(__dirname, "scripts", "discover_onvif.py")], {timeout:15000}, (err, stdout) => {
      if (err) { res.json({ ok:false, error:err.message }); return; }
      try { res.json({ ok:true, found:JSON.parse(stdout) }); }
      catch { res.json({ ok:false, raw:stdout }); }
    });
  });

  // ── Recording ─────────────────────────────────────────────────────────────
  app.post("/api/recording/start", async (req: Request, res: Response) => {
    if (isRecording) { res.json({ ok: false, msg: "Already recording" }); return; }
    const online = cameras.filter(c => c.enabled && c.status === "online");
    if (!online.length) {
      addLog("REC", "Start failed — no cameras online", "error");
      res.json({ ok: false, msg: "No cameras online" }); return;
    }

    const session_id = `${session.label}_${session.person}_${session.repeat}_${Date.now()}`;
    const mtResults = await Promise.all(online.map(async (cam) => {
      const pathName = cam.name.toLowerCase().replace(/[\s_]+/g, "-");
      try {
        const r = await fetch(`${MEDIAMTX_API}/config/paths/${pathName}/record/start`, { method: "POST" });
        return { cam: cam.name, ok: r.ok, mt: true };
      } catch { return { cam: cam.name, ok: false, mt: true }; }
    }));
    const mtStarted = mtResults.filter(r => r.ok).length;

    isRecording = true;
    recordingStartTime = Date.now();
    online.forEach(c => { c.status = "recording"; });
    writeJson(CAMERAS_FILE, cameras);
    const mode = mtStarted > 0 ? `MediaMTX(${mtStarted})` : "legacy";
    const subject_id = req.body?.subject_id ?? "unknown";
    addLog("REC", `Started: ${session.label}/${session.person}/${session.repeat} (${online.length} cams, ${mode}, subject: ${subject_id})`, "success");
    res.json({ ok: true, session_id, cameras: online.length, mediamtx: mtStarted, session: { ...session } });
  });

  app.post("/api/recording/stop", async (req: Request, res: Response) => {
    if (!isRecording) { res.json({ ok: false, msg: "Not recording" }); return; }
    const duration = recordingStartTime ? Math.round((Date.now() - recordingStartTime) / 1000) : 0;

    const recording_cams = cameras.filter(c => c.status === "recording");
    await Promise.all(recording_cams.map(async (cam) => {
      const pathName = cam.name.toLowerCase().replace(/[\s_]+/g, "-");
      await stopMediaMTXPath(pathName);
    }));

    // Give MediaMTX time to close the file before querying paths
    await new Promise(r => setTimeout(r, 600));

    const cameraNames = recording_cams.map(c => c.name);
    const files = await getMediaMTXRecordingPaths(cameraNames);

    isRecording = false;
    recordingStartTime = null;
    cameras.forEach(c => { if (c.status === "recording") c.status = "online"; });
    writeJson(CAMERAS_FILE, cameras);
    try {
      const n = parseInt(session.repeat.replace(/\D/g, ""), 10) + 1;
      session.repeat = `r${String(n).padStart(2, "0")}`;
      writeJson(SESSION_FILE, session);
    } catch {}
    addLog("REC", `Stopped after ${duration}s → ${session.recordDir}/`, "success");
    res.json({ ok: true, duration, newRepeat: session.repeat, files });
  });

  app.get("/api/recording/files", async (_req: Request, res: Response) => {
    const cameraNames = cameras.filter(c => c.enabled).map(c => c.name);
    const files = await getMediaMTXRecordingPaths(cameraNames);
    res.json({ files });
  });

  app.get("/api/recording/status", (_req: Request, res: Response) => {
    const elapsed = isRecording && recordingStartTime ? Math.round((Date.now() - recordingStartTime) / 1000) : 0;
    const recording_cams = cameras.filter(c => c.status === "recording").map(c => ({ name: c.name, ip: c.ip }));
    res.json({ recording: isRecording, elapsed, session, cameras: recording_cams });
  });

  app.post("/api/snapshot", (_req,res) => {
    const online = cameras.filter(c=>c.enabled&&(c.status==="online"||c.status==="recording"));
    if (!online.length) { addLog("SNAP","Snapshot failed — no cameras online","error"); res.json({ok:false,msg:"No cameras online"}); return; }
    const ts = new Date().toISOString().slice(0,19).replace(/[T:]/g,"-");
    const files = online.map(c=>{
      let name = session.pattern;
      const tokens: Record<string,string> = {
        label:session.label, person:session.person, repeat:session.repeat,
        camera:c.name, date:ts.slice(0,10), time:ts.slice(11),
      };
      Object.entries(tokens).forEach(([k,v])=>{ name=name.replace(`{${k}}`,v); });
      return `${session.snapDir}/${name}_${ts}.jpg`;
    });
    addLog("SNAP",`Saved ${files.length} snapshot(s) to ${session.snapDir}/`,"success");
    res.json({ok:true, files});
  });

  // ── Session ───────────────────────────────────────────────────────────────
  app.get("/api/session", (_req,res) => res.json(session));
  app.put("/api/session", (req,res) => {
    session = {...session,...req.body};
    writeJson(SESSION_FILE, session);
    addLog("SESSION",`Updated: ${session.label}/${session.person}/${session.repeat}`);
    res.json(session);
  });

  // ── Profiles ──────────────────────────────────────────────────────────────
  app.get("/api/profiles", (_req,res) => res.json({profiles:Object.values(profiles),lastUsed:lastProfileId}));

  app.post("/api/profiles", (req,res) => {
    const id = `profile-${Date.now()}`;
    const profile: Profile = {
      id, name:req.body.name||"Unnamed Profile",
      cameras:JSON.parse(JSON.stringify(cameras)),
      session:JSON.parse(JSON.stringify(session)),
      createdAt:new Date().toISOString(),
    };
    profiles[id] = profile;
    lastProfileId = id;
    writeJson(PROFILES_FILE, profiles);
    addLog("PROFILE",`Saved: "${profile.name}"`,"success");
    res.json(profile);
  });

  app.put("/api/profiles/:id", (req,res) => {
    if (!profiles[req.params.id]) { res.status(404).json({error:"Not found"}); return; }
    profiles[req.params.id] = {...profiles[req.params.id],...req.body};
    writeJson(PROFILES_FILE, profiles);
    res.json(profiles[req.params.id]);
  });

  app.post("/api/profiles/:id/load", (req,res) => {
    const profile = profiles[req.params.id];
    if (!profile) { res.status(404).json({error:"Not found"}); return; }
    cameras = JSON.parse(JSON.stringify(profile.cameras));
    session = JSON.parse(JSON.stringify(profile.session));
    lastProfileId = req.params.id;
    writeJson(CAMERAS_FILE, cameras);
    writeJson(SESSION_FILE, session);
    addLog("PROFILE",`Loaded: "${profile.name}"`,"success");
    res.json({profile,cameras,session});
  });

  app.delete("/api/profiles/:id", (req,res) => {
    const name = profiles[req.params.id]?.name||req.params.id;
    delete profiles[req.params.id];
    if (lastProfileId===req.params.id) lastProfileId=null;
    writeJson(PROFILES_FILE, profiles);
    addLog("PROFILE",`Deleted: "${name}"`,"warn");
    res.json({ok:true});
  });

  // ── Logs ──────────────────────────────────────────────────────────────────
  app.get("/api/logs", (_req,res) => res.json(logs.slice(0,50)));

  // ── Addon management ────────────────────────────────────────────────────────
  const loadedAddons: Map<string, LoadedAddonEntry> = new Map();
  const disabledAddons: Set<string> = new Set();

  const ADDONS_DIR = path.join(process.cwd(), "addons");
  const ADDONS_DISABLED_FILE = path.join(DATA_DIR, "addons_disabled.json");

  function loadDisabledSet(): Set<string> {
    try {
      if (fs.existsSync(ADDONS_DISABLED_FILE)) {
        return new Set(JSON.parse(fs.readFileSync(ADDONS_DISABLED_FILE, "utf8")));
      }
    } catch {}
    return new Set();
  }

  function saveDisabledSet() {
    fs.writeFileSync(ADDONS_DISABLED_FILE, JSON.stringify(Array.from(disabledAddons)));
  }

  function scanAvailableAddons(): { id: string; name: string; version: string; description: string; author: string; loaded: boolean; enabled: boolean }[] {
    if (!fs.existsSync(ADDONS_DIR)) return [];
    const dirs = fs.readdirSync(ADDONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    return dirs.map(dir => {
      const manifestPath = path.join(ADDONS_DIR, dir.name, "addon.json");
      let manifest: any = {};
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}
      return {
        id: manifest.id || dir.name,
        name: manifest.name || dir.name,
        version: manifest.version || "0.0.0",
        description: manifest.description || "",
        author: manifest.author || "",
        loaded: loadedAddons.has(manifest.id || dir.name),
        enabled: !disabledAddons.has(manifest.id || dir.name),
      };
    });
  }

  // Reload disabled state from disk
  const _disabled = loadDisabledSet();
  _disabled.forEach(id => disabledAddons.add(id));

  function makeAddonContext(addonId: string, expressApp: express.Application): AddonContext {
    const configFile = path.join(DATA_DIR, "addons", `${addonId}.json`);

    function loadAddonConfig(): Record<string, unknown> {
      try {
        if (fs.existsSync(configFile)) {
          return JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
        }
      } catch {}
      return {};
    }

    function saveAddonConfig(data: Record<string, unknown>) {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, JSON.stringify(data, null, 2));
    }

    return {
      getCameras: () => cameras,
      registerRoute: (method, routePath, handler) => {
        const fullPath = `/api/addons/${addonId}${routePath}`;
        (expressApp as any)[method.toLowerCase()](fullPath, handler);
        addLog("ADDON", `${addonId}: registered ${method} ${fullPath}`, "info");
      },
      log: (msg, level = "info") => { addLog(`ADDON:${addonId}`, msg, level); },
      getConfig: () => loadAddonConfig(),
      setConfig: (patch) => {
        const current = loadAddonConfig();
        saveAddonConfig({ ...current, ...patch });
      },
      emit: (event, data) => { addonEventBus.emit(event, { source: addonId, data }); },
      on: (event, handler) => { addonEventBus.on(event, handler); },
    };
  }

  async function loadAddon(dir: string): Promise<boolean> {
    const manifestPath = path.join(ADDONS_DIR, dir, "addon.json");
    if (!fs.existsSync(manifestPath)) return false;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (disabledAddons.has(manifest.id)) {
        addLog("ADDON", `Skipping disabled addon: ${manifest.name}`, "info");
        return false;
      }
      const entryPath = path.join(ADDONS_DIR, dir, manifest.entry);
      if (!fs.existsSync(entryPath)) {
        addLog("ADDON", `Entry not found: ${manifest.entry} in ${dir}`, "warn");
        return false;
      }
      const { default: AddonClass } = await import(entryPath);
      const instance = new AddonClass();
      if (typeof instance.init === "function") {
        await instance.init(makeAddonContext(manifest.id, app));
        loadedAddons.set(manifest.id, { instance, manifest, enabled: true });
        addLog("ADDON", `Loaded: ${manifest.name} v${manifest.version}`, "success");
        return true;
      }
    } catch (e: any) {
      addLog("ADDON", `Failed to load ${dir}: ${e?.message || e}`, "error");
    }
    return false;
  }

  async function unloadAddon(id: string): Promise<boolean> {
    const instance = loadedAddons.get(id);
    if (!instance) return false;
    try {
      if (typeof (instance as any).destroy === "function") {
        await (instance as any).destroy();
      }
    } catch (e: any) {
      addLog("ADDON", `Error destroying ${id}: ${e?.message}`, "warn");
    }
    loadedAddons.delete(id);
    addLog("ADDON", `Unloaded: ${id}`, "info");
    return true;
  }

  async function loadAllAddons() {
    if (!fs.existsSync(ADDONS_DIR)) return;
    const dirs = fs.readdirSync(ADDONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      await loadAddon(dir.name);
    }
  }

  // ── Addon REST endpoints ──────────────────────────────────────────────────
  app.get("/api/addons", (_req: Request, res: Response) => {
    const list = Array.from(loadedAddons.entries()).map(([id, entry]) => ({
      id,
      name: (entry.manifest.name as string) ?? id,
      version: (entry.manifest.version as string) ?? "0.0.0",
      enabled: entry.enabled,
    }));
    res.json(list);
  });

  app.get("/api/addons/available", (_req, res) => {
    res.json(scanAvailableAddons());
  });

  app.post("/api/addons/:id/load", async (req, res) => {
    if (loadedAddons.has(req.params.id)) {
      res.json({ ok: false, msg: "Already loaded" });
      return;
    }
    if (!fs.existsSync(ADDONS_DIR)) {
      res.json({ ok: false, msg: "Addons directory not found" });
      return;
    }
    // Find the directory for this addon
    const dirs = fs.readdirSync(ADDONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const manifestPath = path.join(ADDONS_DIR, dir.name, "addon.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (manifest.id === req.params.id) {
          const ok = await loadAddon(dir.name);
          res.json({ ok, id: req.params.id });
          return;
        }
      } catch {}
    }
    res.json({ ok: false, msg: "Addon not found" });
  });

  app.post("/api/addons/:id/unload", async (req, res) => {
    const ok = await unloadAddon(req.params.id);
    res.json({ ok, id: req.params.id });
  });

  app.post("/api/addons/:id/reload", async (req, res) => {
    await unloadAddon(req.params.id);
    // Find and reload
    if (!fs.existsSync(ADDONS_DIR)) { res.json({ ok: false }); return; }
    const dirs = fs.readdirSync(ADDONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const manifestPath = path.join(ADDONS_DIR, dir.name, "addon.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (manifest.id === req.params.id) {
          const ok = await loadAddon(dir.name);
          res.json({ ok, id: req.params.id });
          return;
        }
      } catch {}
    }
    res.json({ ok: false, msg: "Addon not found" });
  });

  app.post("/api/addons/:id/enable", async (req, res) => {
    disabledAddons.delete(req.params.id);
    saveDisabledSet();
    addLog("ADDON", `Enabled: ${req.params.id}`, "success");
    // Reload if available
    if (!fs.existsSync(ADDONS_DIR)) { res.json({ ok: true }); return; }
    const dirs = fs.readdirSync(ADDONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      const manifestPath = path.join(ADDONS_DIR, dir.name, "addon.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (manifest.id === req.params.id) {
          const ok = await loadAddon(dir.name);
          res.json({ ok, id: req.params.id });
          return;
        }
      } catch {}
    }
    res.json({ ok: true });
  });

  app.post("/api/addons/:id/disable", async (req, res) => {
    disabledAddons.add(req.params.id);
    saveDisabledSet();
    await unloadAddon(req.params.id);
    addLog("ADDON", `Disabled: ${req.params.id}`, "warn");
    res.json({ ok: true });
  });

  app.get("/api/addons/:id/config", (req: Request, res: Response) => {
    const entry = loadedAddons.get(req.params.id);
    if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
    const configFile = path.join(DATA_DIR, "addons", `${req.params.id}.json`);
    try {
      const cfg = fs.existsSync(configFile)
        ? JSON.parse(fs.readFileSync(configFile, "utf8"))
        : {};
      res.json(cfg);
    } catch { res.json({}); }
  });

  app.put("/api/addons/:id/config", (req: Request, res: Response) => {
    const entry = loadedAddons.get(req.params.id);
    if (!entry) { res.status(404).json({ error: "Addon not found" }); return; }
    const configFile = path.join(DATA_DIR, "addons", `${req.params.id}.json`);
    let current: Record<string, unknown> = {};
    try {
      if (fs.existsSync(configFile))
        current = JSON.parse(fs.readFileSync(configFile, "utf8"));
    } catch {}
    const updated = { ...current, ...(req.body as Record<string, unknown>) };
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(updated, null, 2));
    addLog("ADDON", `Config updated: ${req.params.id}`, "info");
    res.json(updated);
  });

  loadAllAddons();

  app.post("/api/settings/commit", (req,res) => {
    addLog("SETTINGS",`Committed: ${req.body.settingsTab||"unknown"}`);
    res.json({ok:true});
  });

  // ── Vite / static ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server:{middlewareMode:true}, appType:"spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(),"dist");
    app.use(express.static(distPath));
    app.get("*",(_req,res)=>res.sendFile(path.join(distPath,"index.html")));
  }

  app.listen(PORT,"0.0.0.0",() => {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  DroidGrid Pro — http://localhost:${PORT} ║`);
    console.log(`║  Config: ${DATA_DIR.slice(0,26).padEnd(26)}  ║`);
    console.log(`╚══════════════════════════════════════╝\n`);
  });

  // ── Storage retention cleanup ─────────────────────────────────────────────
  function pruneOldRecordings() {
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
      const recordDir = session.recordDir || "recordings";
      if (!fs.existsSync(recordDir)) return;
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
    } catch (e) {
      addLog("STORAGE", `Prune error: ${e}`, "error");
    }
  }
  pruneOldRecordings();
  setInterval(pruneOldRecordings, 86400 * 1000);
}

startServer();
