/**
 * DroidGrid Pro — App.tsx
 * Same visual design, fully wired to real backend APIs.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu, Battery, Thermometer, ShieldCheck, Database, Terminal, Wifi,
  Settings, Activity, HardDrive, Smartphone, Zap, Clock, Search,
  File, Folder, Download, Trash2, Save, Globe, Lock, Share2,
  ChevronRight, X, Plus, Play, Square, Camera, RefreshCw, CheckCircle,
  AlertCircle, Loader, Edit2, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CameraCell } from './components/CameraCell';

// ── Types ────────────────────────────────────────────────────────────────────
interface Camera {
  id: string; name: string; ip: string; port: number;
  res: [number, number]; fps: number; enabled: boolean;
  status: 'online'|'offline'|'checking'|'recording';
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
  level: 'info'|'warn'|'error'|'success';
}

// ── Addon type ─────────────────────────────────────────────────────────────────
interface AddonManifest {
  id: string; name: string; version: string; description: string;
  author: string; loaded: boolean; enabled: boolean;
}

// ── API helpers ───────────────────────────────────────────────────────────────
const api = {
  get:    (path: string) => fetch(path).then(r => r.json()),
  post:   (path: string, body?: unknown) => fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined }).then(r => r.json()),
  put:    (path: string, body: unknown)  => fetch(path, { method:'PUT',  headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.json()),
  delete: (path: string) => fetch(path, { method:'DELETE' }).then(r => r.json()),
};

// ── BentoCard ─────────────────────────────────────────────────────────────────
const BentoCard = ({ children, className="", title, sub }: { children: React.ReactNode; className?: string; title?: string; sub?: string }) => (
  <div className={`bg-surface-card border border-surface-border rounded-2xl p-5 flex flex-col relative overflow-hidden transition-all hover:border-brand/40 group ${className}`}>
    {(title||sub) && (
      <div className="flex flex-col gap-1 mb-4 z-10">
        {sub   && <span className="text-brand text-[10px] font-mono uppercase tracking-tighter">{sub}</span>}
        {title && <h3 className="text-sm font-bold text-text-dim uppercase tracking-widest">{title}</h3>}
      </div>
    )}
    <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
  </div>
);

// ── Status dot ────────────────────────────────────────────────────────────────
const StatusDot = ({ status }: { status: Camera['status'] }) => {
  const map = { online:'bg-brand', offline:'bg-red-500', checking:'bg-yellow-400 animate-pulse', recording:'bg-red-500 animate-pulse' };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status]}`} />;
};

// ── Log level colour ─────────────────────────────────────────────────────────
const logColour = (level: LogEntry['level']) => ({
  success:'text-brand', warn:'text-yellow-400', error:'text-red-400', info:'text-blue-400'
}[level] ?? 'text-text-dim');

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [view, setView]           = useState<'dashboard'|'cameras'|'settings'|'extensions'>('dashboard');
  const [settingsTab, setSettingsTab] = useState('General');
  const [selectedProfile, setSelectedProfile] = useState<Profile|null>(null);

  // ── server state ─────────────────────────────────────────────────────────
  const [cameras, setCameras]       = useState<Camera[]>([]);
  const [mediamtxBase, setMediamtxBase] = useState<string>("http://localhost:8889");
  const [profiles, setProfiles]     = useState<Profile[]>([]);
  const [session, setSession]       = useState<SessionState>({ label:'session', person:'p01', repeat:'r01', pattern:'{label}_{person}_{repeat}_{camera}', recordDir:'recordings', snapDir:'snapshots' });
  const [logs, setLogs]             = useState<LogEntry[]>([]);
  const [recording, setRecording]   = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [isLoading, setIsLoading]   = useState(true);
  const [isSaving, setIsSaving]     = useState(false);
  const [lastSnap, setLastSnap]     = useState<string[]>([]);
  const [toast, setToast]           = useState<{msg:string;ok:boolean}|null>(null);
  const [addons, setAddons]         = useState<AddonManifest[]>([]);
  const [showLive, setShowLive] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredCams, setDiscoveredCams] = useState<Array<{ address: string; name?: string; rtsp_url?: string }>>([]);
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const recTimer = useRef<ReturnType<typeof setInterval>|null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({msg, ok});
    setTimeout(() => setToast(null), 3000);
  };

  // ── addon actions ─────────────────────────────────────────────────────────
  const loadAddon = async (id: string) => {
    const r = await api.post(`/api/addons/${id}/load`);
    if (r.ok) showToast(`Addon loaded: ${id}`);
    else showToast(r.msg || `Failed to load ${id}`, false);
    fetchAddons();
  };

  const unloadAddon = async (id: string) => {
    const r = await api.post(`/api/addons/${id}/unload`);
    if (r.ok) showToast(`Addon unloaded: ${id}`);
    fetchAddons();
  };

  const enableAddon = async (id: string) => {
    const r = await api.post(`/api/addons/${id}/enable`);
    if (r.ok) showToast(`Addon enabled: ${id}`);
    fetchAddons();
  };

  const disableAddon = async (id: string) => {
    const r = await api.post(`/api/addons/${id}/disable`);
    if (r.ok) showToast(`Addon disabled: ${id}`);
    fetchAddons();
  };

  const fetchAddons = async () => {
    try {
      const list = await api.get('/api/addons/available');
      setAddons(list || []);
    } catch {}
  };

  // ── fetch all state ───────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const [cams, prof, sess, logsData, recStatus, health] = await Promise.all([
        api.get('/api/cameras'),
        api.get('/api/profiles'),
        api.get('/api/session'),
        api.get('/api/logs'),
        api.get('/api/recording/status'),
        api.get('/api/health'),
      ]);
      setCameras(cams);
      setProfiles(prof.profiles || []);
      setSession(sess);
      setLogs(logsData);
      setRecording(recStatus.recording);
      if (recStatus.recording) setRecElapsed(recStatus.elapsed);
      if (health?.mediamtxBase) setMediamtxBase(health.mediamtxBase);
      setIsLoading(false);
    } catch (e) {
      console.error('Backend sync failed:', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    fetchAddons();
    const iv = setInterval(refresh, 4000);
    const iv2 = setInterval(fetchAddons, 10000);
    return () => { clearInterval(iv); clearInterval(iv2); };
  }, [refresh]);

  // ── recording timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (recording) {
      recTimer.current = setInterval(() => setRecElapsed(e => e + 1), 1000);
    } else {
      if (recTimer.current) clearInterval(recTimer.current);
      setRecElapsed(0);
    }
    return () => { if (recTimer.current) clearInterval(recTimer.current); };
  }, [recording]);

  const fmtTime = (s: number) => {
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
    if (h>0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  };

  // ── camera actions ────────────────────────────────────────────────────────
  const addCamera = async () => {
    const cam = await api.post('/api/cameras', { name:`Phone-${cameras.length+1}`, ip:'', port:4747, res:[1280,720], fps:30 });
    setCameras(prev => [...prev, cam]);
  };

  const updateCamera = async (id: string, patch: Partial<Camera>) => {
    const updated = await api.put(`/api/cameras/${id}`, patch);
    setCameras(prev => prev.map(c => c.id===id ? updated : c));
  };

  const removeCamera = async (id: string) => {
    await api.delete(`/api/cameras/${id}`);
    setCameras(prev => prev.filter(c => c.id!==id));
  };

  const testCamera = async (id: string) => {
    setCameras(prev => prev.map(c => c.id===id ? {...c, status:'checking'} : c));
    const r = await api.post(`/api/cameras/${id}/test`);
    setCameras(prev => prev.map(c => c.id===id ? {...c, status:r.status} : c));
  };

  const testAll = async () => {
    setCameras(prev => prev.map(c => c.enabled ? {...c, status:'checking'} : c));
    const r = await api.post('/api/cameras/test-all');
    if (r.cameras) {
      const map: Record<string,Camera['status']> = {};
      r.cameras.forEach((c: {id:string;status:Camera['status']}) => { map[c.id] = c.status; });
      setCameras(prev => prev.map(c => map[c.id] ? {...c, status:map[c.id]} : c));
    }
  };

  // ── recording ─────────────────────────────────────────────────────────────
  const startRec = async () => {
    const r = await api.post('/api/recording/start');
    if (r.ok) { setRecording(true); showToast(`Recording started — ${r.cameras} cameras`); }
    else showToast(r.msg || 'Failed to start', false);
    refresh();
  };

  const stopRec = async () => {
    const r = await api.post('/api/recording/stop');
    if (r.ok) {
      setRecording(false);
      setSession(prev => ({...prev, repeat:r.newRepeat}));
      showToast(`Saved — ${fmtTime(r.duration || 0)}`);
    }
    refresh();
  };

  const takeSnapshot = async () => {
    const r = await api.post('/api/snapshot');
    if (r.ok) { setLastSnap(r.files || []); showToast(`${r.files?.length || 0} snapshots saved`); }
    else showToast(r.msg || 'No cameras online', false);
  };

  // ── session ───────────────────────────────────────────────────────────────
  const saveSession = async (patch: Partial<SessionState>) => {
    const updated = await api.put('/api/session', patch);
    setSession(updated);
  };

  // ── profiles ──────────────────────────────────────────────────────────────
  const saveProfile = async (name: string) => {
    const p = await api.post('/api/profiles', { name });
    setProfiles(prev => [...prev.filter(x=>x.id!==p.id), p]);
    showToast(`Profile "${name}" saved`);
  };

  const loadProfile = async (id: string) => {
    const r = await api.post(`/api/profiles/${id}/load`);
    setCameras(r.cameras);
    setSession(r.session);
    setSelectedProfile(null);
    showToast(`Profile "${r.profile.name}" loaded`);
  };

  const deleteProfile = async (id: string, name: string) => {
    await api.delete(`/api/profiles/${id}`);
    setProfiles(prev => prev.filter(p => p.id!==id));
    if (selectedProfile?.id===id) setSelectedProfile(null);
    showToast(`Profile "${name}" deleted`, false);
  };

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
    } finally { setDiscovering(false); }
  };

  const onlineCount  = cameras.filter(c=>c.status==='online'||c.status==='recording').length;
  const enabledCount = cameras.filter(c=>c.enabled).length;

  // ── Loading screen ────────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="min-h-screen bg-surface-bg flex items-center justify-center p-6 text-center">
      <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="max-w-xs w-full">
        <div className="w-16 h-16 border-t-2 border-brand rounded-full animate-spin mx-auto mb-6 shadow-[0_0_20px_rgba(61,220,132,0.2)]"></div>
        <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">DroidGrid</h2>
        <p className="text-text-muted text-xs font-mono">CONNECTING TO BACKEND...</p>
        <div className="mt-8 bg-surface-border/30 h-1 rounded-full overflow-hidden">
          <motion.div animate={{x:[-100,300]}} transition={{duration:1.5,repeat:Infinity,ease:"linear"}} className="bg-brand w-1/3 h-full shadow-[0_0_10px_#3ddc84]" />
        </div>
      </motion.div>
    </div>
  );

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const renderDashboard = () => (
    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 md:grid-rows-6 gap-4">
      {/* Status hero */}
      <BentoCard className="md:col-span-8 md:row-span-3 !p-6 md:!p-8" sub="Multi-Camera Controller">
        <div className="absolute top-0 right-0 p-8 opacity-[0.03] -rotate-12 pointer-events-none group-hover:opacity-[0.07] transition-opacity">
          <Smartphone size={320} />
        </div>
        <div className="z-10 flex flex-col h-full">
          <h2 className="text-3xl md:text-5xl font-black mb-2 text-white">DroidGrid <span className="text-brand">Pro</span></h2>
          <p className="text-text-muted text-xs md:text-sm italic flex items-center gap-2">
            <Zap size={14} className="text-brand" />
            {onlineCount}/{cameras.length} cameras online · Session: {session.label}/{session.person}/{session.repeat}
          </p>
          <div className="mt-auto grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8">
            {[
              { label:'Cameras',   value:`${onlineCount} / ${cameras.length}`, icon:<Smartphone className="text-brand" size={16}/>, sub: onlineCount>0?'Online':'Offline' },
              { label:'Recording', value: recording ? fmtTime(recElapsed) : 'Idle', icon:<Activity className={recording?"text-red-400 animate-pulse":"text-brand"} size={16}/>, sub: recording?'Active':'Stopped' },
              { label:'Profiles',  value:`${profiles.length}`, icon:<Database className="text-brand" size={16}/>, sub:'Saved' },
            ].map((stat,i) => (
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.1}}
                className="bg-black/40 border border-surface-border rounded-xl p-4 hover:border-brand/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-text-dim uppercase font-bold tracking-widest">{stat.label}</span>
                  {stat.icon}
                </div>
                <p className="text-xl md:text-2xl font-mono text-white">{stat.value}</p>
                <span className="text-[10px] uppercase text-brand/60">{stat.sub}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </BentoCard>

      {/* Quick actions */}
      <BentoCard title="Quick Actions" className="md:col-span-4 md:row-span-2">
        <div className="flex flex-col gap-3 h-full justify-center">
          {!recording ? (
            <button onClick={startRec}
              className="w-full bg-brand hover:bg-brand/90 text-black font-bold py-2.5 rounded-lg text-sm transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-brand/10 flex items-center justify-center gap-2">
              <Play size={14} /> Start Recording
            </button>
          ) : (
            <button onClick={stopRec}
              className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-lg text-sm transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 animate-pulse">
              <Square size={14} /> Stop — {fmtTime(recElapsed)}
            </button>
          )}
          <button onClick={takeSnapshot}
            className="w-full bg-surface-border/50 hover:bg-surface-border text-white py-2.5 rounded-lg text-sm border border-surface-border transition-all flex items-center justify-center gap-2">
            <Camera size={14} /> Snapshot All
          </button>
          <button onClick={testAll}
            className="w-full bg-surface-border/30 hover:bg-surface-border/50 text-text-muted py-2.5 rounded-lg text-sm border border-surface-border/50 transition-all flex items-center justify-center gap-2">
            <RefreshCw size={14} /> Test All Cameras
          </button>
          <button onClick={() => setView('cameras')}
            className="w-full bg-surface-border/20 text-text-dim py-2 rounded-lg text-xs border border-surface-border/30 transition-all hover:text-white">
            Manage Cameras →
          </button>
        </div>
      </BentoCard>

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
                  label={cam.name}
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

      {/* Profiles */}
      <BentoCard title="Saved Profiles" className="md:col-span-4 md:row-span-3">
        <div className="absolute top-4 right-4">
          <span className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full border border-brand/20">{profiles.length} Total</span>
        </div>
        <div className="flex-1 overflow-y-auto mt-2 pr-1 custom-scrollbar">
          <div className="flex flex-col gap-2.5">
            {profiles.map((p) => (
              <button key={p.id} onClick={() => setSelectedProfile(p)}
                className="p-3 rounded-xl border transition-all flex justify-between items-center text-left group/profile bg-black/20 border-surface-border opacity-80 hover:opacity-100 hover:border-surface-border/80">
                <div className="flex flex-col">
                  <span className="text-xs md:text-sm font-medium text-white">{p.name}</span>
                  <span className="text-[9px] text-text-dim">{new Date(p.createdAt).toLocaleDateString()} · {p.cameras.length} cams</span>
                </div>
                <ChevronRight size={14} className="text-text-dim group-hover/profile:text-brand transition-colors" />
              </button>
            ))}
            {profiles.length===0 && <p className="text-text-dim text-xs text-center py-4">No profiles saved yet</p>}
          </div>
        </div>
        <button onClick={() => { const n = prompt('Profile name:','My Setup'); if(n) saveProfile(n.trim()); }}
          className="mt-4 text-center text-[10px] md:text-xs text-text-dim hover:text-white py-3 border-t border-surface-border transition-colors flex items-center justify-center gap-2">
          <Plus size={12} /> Save Current as Profile
        </button>
      </BentoCard>

      {/* Log stream */}
      <BentoCard title="Live Log Stream" className="md:col-span-5 md:row-span-3">
        <div className="flex-1 font-mono text-[9px] md:text-[11px] text-text-muted overflow-hidden space-y-1.5 bg-black/40 p-4 rounded-xl border border-surface-border shadow-inner">
          {logs.slice(0,8).map(log => (
            <p key={log.id} className="flex gap-2 truncate">
              <span className={logColour(log.level)}>[{log.time}]</span>
              <span className="text-white hidden sm:inline">{log.system}:</span>
              {log.msg}
            </p>
          ))}
          <p className="flex gap-2 opacity-40 animate-pulse">
            <span className="text-brand">[{new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}]</span>
            <span className="hidden sm:inline text-white">LISTEN:</span> Waiting...
          </p>
        </div>
      </BentoCard>

      {/* Session info */}
      <BentoCard title="Session" className="md:col-span-3 md:row-span-3 justify-between">
        <div className="z-10 space-y-3">
          {([
            ['Label',      'label'],
            ['Person',     'person'],
            ['Repeat',     'repeat'],
            ['Pattern',    'pattern'],
            ['Record Dir', 'recordDir'],
          ] as [string, keyof SessionState][]).map(([label, key]) => (
            <div key={key}>
              <p className="text-[9px] text-text-dim uppercase font-bold tracking-widest mb-1">{label}</p>
              <input
                className="w-full bg-black/60 border border-surface-border rounded-lg px-2 py-1.5 text-xs font-mono text-brand focus:border-brand/40 outline-none transition-all"
                value={session[key]}
                onChange={e => saveSession({[key]: e.target.value})}
              />
            </div>
          ))}
        </div>
        {lastSnap.length > 0 && (
          <div className="mt-3 p-2 bg-brand/5 border border-brand/20 rounded-lg">
            <p className="text-[9px] text-brand uppercase font-bold mb-1">Last Snapshots</p>
            {lastSnap.slice(0,2).map((f,i) => (
              <p key={i} className="text-[9px] font-mono text-text-muted truncate">{f.split('/').pop()}</p>
            ))}
          </div>
        )}
      </BentoCard>
    </div>
  );

  // ── Camera Manager ────────────────────────────────────────────────────────
  const CameraRow = ({ cam }: { cam: Camera; key?: string }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(cam);

    const save = () => { updateCamera(cam.id, draft); setEditing(false); };
    const cancel = () => { setDraft(cam); setEditing(false); };

    return (
      <motion.div layout className={`p-4 rounded-2xl border transition-all ${cam.status==='recording'?'border-red-500/40 bg-red-950/10':cam.status==='online'?'border-brand/30 bg-brand/5':'border-surface-border bg-black/20'}`}>
        <div className="flex items-center gap-3 flex-wrap">
          {/* enable toggle */}
          <button onClick={() => updateCamera(cam.id, {enabled:!cam.enabled})}
            className={`w-10 h-5 rounded-full relative p-0.5 transition-colors flex-shrink-0 ${cam.enabled?'bg-brand':'bg-surface-border'}`}>
            <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${cam.enabled?'translate-x-5':'translate-x-0'}`}/>
          </button>

          {/* status */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <StatusDot status={cam.status} />
            <span className="text-[9px] uppercase font-bold text-text-dim tracking-wider">{cam.status}</span>
          </div>

          {editing ? (
            <>
              <input className="flex-1 min-w-[80px] bg-black/60 border border-surface-border rounded-lg px-2 py-1 text-xs text-white font-bold outline-none focus:border-brand/40"
                value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Name"/>
              <input className="flex-1 min-w-[120px] bg-black/60 border border-surface-border rounded-lg px-2 py-1 text-xs font-mono text-brand outline-none focus:border-brand/40"
                value={draft.ip} onChange={e=>setDraft({...draft,ip:e.target.value})} placeholder="192.168.x.x"/>
              <input type="number" className="w-16 bg-black/60 border border-surface-border rounded-lg px-2 py-1 text-xs font-mono text-brand outline-none focus:border-brand/40"
                value={draft.port} onChange={e=>setDraft({...draft,port:+e.target.value})} placeholder="4747"/>
              <select className="bg-black/60 border border-surface-border rounded-lg px-2 py-1 text-xs text-text-muted outline-none"
                value={`${draft.res[0]}x${draft.res[1]}`}
                onChange={e=>{ const[w,h]=e.target.value.split('x').map(Number); setDraft({...draft,res:[w,h]}); }}>
                {['1920x1080','1280x720','960x540','640x480'].map(r=><option key={r}>{r}</option>)}
              </select>
              <select className="w-16 bg-black/60 border border-surface-border rounded-lg px-2 py-1 text-xs text-text-muted outline-none"
                value={draft.fps} onChange={e=>setDraft({...draft,fps:+e.target.value})}>
                {[10,15,20,24,25,30].map(f=><option key={f}>{f}</option>)}
              </select>
              <button onClick={save} className="p-1.5 bg-brand/20 text-brand rounded-lg hover:bg-brand/30 transition-colors"><Check size={14}/></button>
              <button onClick={cancel} className="p-1.5 bg-surface-border/50 text-text-dim rounded-lg hover:bg-surface-border transition-colors"><X size={14}/></button>
            </>
          ) : (
            <>
              <span className="font-bold text-sm text-white flex-shrink-0">{cam.name}</span>
              <span className="font-mono text-xs text-brand">{cam.ip}:{cam.port}</span>
              <span className="text-[10px] text-text-dim">{cam.res[0]}×{cam.res[1]} @{cam.fps}fps</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => testCamera(cam.id)}
                  disabled={cam.status==='checking'}
                  className="text-[10px] px-3 py-1.5 rounded-lg border border-surface-border text-text-dim hover:border-brand/30 hover:text-brand transition-all disabled:opacity-40 flex items-center gap-1">
                  {cam.status==='checking' ? <Loader size={10} className="animate-spin"/> : <Wifi size={10}/>} Test
                </button>
                <button onClick={() => setEditing(true)} className="p-1.5 hover:bg-white/5 rounded-lg text-text-dim hover:text-white transition-colors"><Edit2 size={14}/></button>
                <button onClick={() => removeCamera(cam.id)} className="p-1.5 hover:bg-red-950/30 rounded-lg text-text-dim hover:text-red-400 transition-colors"><Trash2 size={14}/></button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    );
  };

  const renderCameras = () => (
    <div className="flex-1 flex flex-col md:grid md:grid-cols-12 gap-4">
      <div className="md:col-span-8 flex flex-col gap-4">
        <BentoCard>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">Camera Fleet</h3>
              <p className="text-[10px] text-text-dim mt-0.5">{onlineCount}/{cameras.length} online · {enabledCount} enabled</p>
              <button
                onClick={() => setShowLive(v => !v)}
                className={`mt-1 text-[9px] px-2 py-0.5 rounded border transition-all font-mono uppercase ${showLive ? 'border-brand/40 text-brand bg-brand/5' : 'border-surface-border text-text-dim hover:text-white'}`}
              >
                {showLive ? '▣ Hide Live' : '▷ Show Live'}
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={testAll} className="flex items-center gap-1.5 bg-surface-border/50 text-text-muted hover:text-white border border-surface-border px-3 py-1.5 rounded-lg text-xs transition-all">
                <RefreshCw size={12}/> Test All
              </button>
              <button
                onClick={discoverCameras}
                disabled={discovering}
                className="flex items-center gap-1.5 bg-surface-border/50 text-text-muted hover:text-white border border-surface-border px-3 py-1.5 rounded-lg text-xs transition-all disabled:opacity-40"
              >
                {discovering ? <Loader size={12} className="animate-spin"/> : <Search size={12}/>}
                {discovering ? 'Scanning...' : 'Discover ONVIF'}
              </button>
              <button onClick={addCamera} className="flex items-center gap-1.5 bg-brand/10 text-brand hover:bg-brand/20 border border-brand/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-all">
                <Plus size={12}/> Add Camera
              </button>
            </div>
          </div>
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
                      label={cam.name}
                    />
                    <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/60 text-[9px] font-mono text-text-muted">
                      {cam.name}
                    </div>
                  </div>
                ))
              }
            </div>
          )}
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {cameras.map(cam => <CameraRow key={cam.id} cam={cam}/>)}
            </AnimatePresence>
            {cameras.length===0 && (
              <div className="text-center py-12">
                <Smartphone size={32} className="mx-auto text-text-dim/30 mb-3"/>
                <p className="text-text-dim text-sm">No cameras configured.</p>
                <button onClick={addCamera} className="mt-4 text-brand text-xs hover:underline">+ Add your first camera</button>
              </div>
            )}
          </div>
        </BentoCard>
      </div>

      {/* Right panel: recording + session */}
      <div className="md:col-span-4 flex flex-col gap-4">
        <BentoCard title="Recording Control">
          <div className="space-y-3">
            {!recording ? (
              <button onClick={startRec} className="w-full bg-brand hover:bg-brand/90 text-black font-black py-3 rounded-xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:scale-[1.02]">
                <Play size={14}/> Start Recording
              </button>
            ) : (
              <button onClick={stopRec} className="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                <Square size={14}/> Stop · {fmtTime(recElapsed)}
              </button>
            )}
            <button onClick={takeSnapshot} className="w-full border border-surface-border text-text-muted hover:text-white py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2">
              <Camera size={12}/> Snapshot All Cameras
            </button>
            {recording && (
              <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"/>
                <span className="text-red-400 text-xs font-mono">REC {fmtTime(recElapsed)}</span>
              </div>
            )}
          </div>
        </BentoCard>

        <BentoCard title="Session Settings">
          <div className="space-y-3">
            {([['Label','label'],['Person','person'],['Repeat','repeat']] as [string,keyof SessionState][]).map(([label,key]) => (
              <div key={key}>
                <p className="text-[9px] text-text-dim uppercase font-bold mb-1">{label}</p>
                <input className="w-full bg-black/60 border border-surface-border rounded-lg px-3 py-2 text-xs font-mono text-brand outline-none focus:border-brand/40 transition-all"
                  value={session[key]} onChange={e=>saveSession({[key]:e.target.value})}/>
              </div>
            ))}
            <div>
              <p className="text-[9px] text-text-dim uppercase font-bold mb-1">Naming Pattern</p>
              <input className="w-full bg-black/60 border border-surface-border rounded-lg px-3 py-2 text-xs font-mono text-text-muted outline-none focus:border-brand/40 transition-all"
                value={session.pattern} onChange={e=>saveSession({pattern:e.target.value})}/>
              <p className="text-[9px] text-text-dim mt-1">{'tokens: {label} {person} {repeat} {camera} {date} {time}'}</p>
            </div>
          </div>
        </BentoCard>

        <BentoCard title="Profiles">
          <div className="space-y-2 mb-3 max-h-40 overflow-y-auto custom-scrollbar">
            {profiles.map(p => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-black/20 border border-surface-border/50 hover:border-surface-border transition-colors group">
                <div>
                  <p className="text-xs text-white font-medium">{p.name}</p>
                  <p className="text-[9px] text-text-dim">{p.cameras.length} cams</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={()=>loadProfile(p.id)} className="text-[9px] px-2 py-1 bg-brand/10 text-brand rounded border border-brand/20 hover:bg-brand/20">Load</button>
                  <button onClick={()=>deleteProfile(p.id,p.name)} className="text-[9px] px-2 py-1 bg-red-950/20 text-red-400 rounded border border-red-900/30"><Trash2 size={10}/></button>
                </div>
              </div>
            ))}
            {profiles.length===0 && <p className="text-text-dim text-xs text-center py-2">No profiles saved</p>}
          </div>
          <button onClick={()=>{ const n=prompt('Profile name:','My Setup'); if(n) saveProfile(n.trim()); }}
            className="w-full text-[10px] text-text-dim hover:text-white py-2 border-t border-surface-border transition-colors flex items-center justify-center gap-1">
            <Plus size={10}/> Save Current Configuration
          </button>
        </BentoCard>
      </div>
    </div>
  );

  // ── Extensions ────────────────────────────────────────────────────────────
  const renderExtensions = () => (
    <div className="flex-1 flex flex-col md:grid md:grid-cols-12 gap-4">
      <BentoCard className="md:col-span-12">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
              <Terminal size={14}/> Addon Extensions
            </h3>
            <p className="text-[10px] text-text-dim mt-0.5">Install and manage DroidGrid addons</p>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-text-dim font-mono">
            <span>{addons.filter(a=>a.loaded).length} loaded</span>
            <span className="text-brand">{addons.filter(a=>a.enabled).length} enabled</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {addons.length === 0 && (
            <div className="md:col-span-2 text-center py-16">
              <Terminal size={32} className="mx-auto text-text-dim/30 mb-3"/>
              <p className="text-text-dim text-sm">No addons found.</p>
              <p className="text-text-dim/60 text-xs mt-1">Place addon directories in the <code className="text-brand">addons/</code> folder</p>
            </div>
          )}
          {addons.map(a => (
            <motion.div key={a.id} layout initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}
              className={`rounded-2xl border p-5 transition-all ${
                a.loaded && a.enabled
                  ? 'border-brand/30 bg-brand/5'
                  : a.enabled
                  ? 'border-surface-border bg-black/30'
                  : 'border-surface-border/50 bg-black/20 opacity-60'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-white truncate">{a.name}</h4>
                    <span className="text-[9px] font-mono text-text-dim bg-surface-border/50 px-1.5 py-0.5 rounded flex-shrink-0">v{a.version}</span>
                  </div>
                  {a.author && <p className="text-[9px] text-text-dim mt-0.5">by {a.author}</p>}
                </div>
                <StatusDot status={a.loaded && a.enabled ? 'online' : 'offline'} />
              </div>

              {a.description && (
                <p className="text-[10px] text-text-muted leading-relaxed mb-4 line-clamp-2">{a.description}</p>
              )}

              <div className="flex items-center gap-2 text-[9px] font-mono mb-4 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full ${a.loaded ? 'bg-brand/10 text-brand border border-brand/20' : 'bg-surface-border/30 text-text-dim border border-surface-border/50'}`}>
                  {a.loaded ? 'loaded' : 'unloaded'}
                </span>
                <span className={`px-2 py-0.5 rounded-full ${a.enabled ? 'bg-green-950/20 text-green-400 border border-green-900/30' : 'bg-surface-border/30 text-text-dim border border-surface-border/50'}`}>
                  {a.enabled ? 'enabled' : 'disabled'}
                </span>
                <span className="text-text-dim">{a.id}</span>
              </div>

              <div className="flex gap-2 flex-wrap">
                {!a.loaded && a.enabled && (
                  <button onClick={() => loadAddon(a.id)}
                    className="flex-1 min-w-[80px] bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 rounded-lg py-2 text-[10px] font-bold transition-all flex items-center justify-center gap-1">
                    <Play size={10}/> Load
                  </button>
                )}
                {a.loaded && (
                  <button onClick={() => unloadAddon(a.id)}
                    className="flex-1 min-w-[80px] bg-red-950/20 text-red-400 border border-red-900/30 hover:bg-red-950/30 rounded-lg py-2 text-[10px] font-bold transition-all flex items-center justify-center gap-1">
                    <Square size={10}/> Unload
                  </button>
                )}
                {a.enabled ? (
                  <button onClick={() => disableAddon(a.id)}
                    className="flex-1 min-w-[80px] bg-surface-border/30 text-text-dim hover:bg-surface-border/50 rounded-lg py-2 text-[10px] transition-all flex items-center justify-center gap-1">
                    Disable
                  </button>
                ) : (
                  <button onClick={() => enableAddon(a.id)}
                    className="flex-1 min-w-[80px] bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 rounded-lg py-2 text-[10px] font-bold transition-all flex items-center justify-center gap-1">
                    <Check size={10}/> Enable
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </BentoCard>

      <BentoCard title="How to Install Addons" className="md:col-span-12">
        <div className="font-mono text-[10px] text-text-muted space-y-3 leading-relaxed">
          <p>Addons are self-contained directories in <code className="text-brand">addons/&lt;name&gt;/</code> with an <code className="text-brand">addon.json</code> manifest.</p>
          <div className="bg-black/40 p-4 rounded-xl border border-surface-border">
            <p className="text-text-dim mb-2">Minimal structure:</p>
            <pre className="text-brand whitespace-pre">addons/my-addon/
  ├── addon.json       # manifest
  └── index.ts         # entry (default export)</pre>
          </div>
          <p>The addon API provides: <span className="text-white">getCameras()</span>, <span className="text-white">registerRoute()</span>, <span className="text-white">log()</span>, <span className="text-white">getConfig()</span>, <span className="text-white">setConfig()</span>, <span className="text-white">emit()</span>, <span className="text-white">on()</span></p>
          <p>See <code className="text-brand">ADDONS_CONTRIBUTE.md</code> for the full developer guide.</p>
        </div>
      </BentoCard>
    </div>
  );

  // ── Settings ──────────────────────────────────────────────────────────────
  const renderSettings = () => (
    <div className="flex-1 flex flex-col md:grid md:grid-cols-12 md:grid-rows-6 gap-4">
      <div className="md:hidden flex overflow-x-auto gap-2 pb-2 custom-scrollbar">
        {['General','Session','Networking','Advanced'].map(t => (
          <button key={t} onClick={()=>setSettingsTab(t)}
            className={`flex items-center gap-2 p-2.5 rounded-xl text-xs whitespace-nowrap border ${settingsTab===t?'bg-brand/10 border-brand/20 text-brand':'bg-surface-card border-surface-border text-text-dim'}`}>
            {t}
          </button>
        ))}
      </div>
      <BentoCard title="Settings" className="hidden md:flex md:col-span-3 md:row-span-6">
        <div className="flex flex-col gap-2 mt-2">
          {[['General',<Settings size={14}/>],['Session',<Clock size={14}/>],['Networking',<Globe size={14}/>],['Advanced',<Terminal size={14}/>]].map(([id,icon]) => (
            <div key={id as string} onClick={()=>setSettingsTab(id as string)}
              className={`flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer transition-all border ${settingsTab===id?'bg-brand/5 border-brand/20 text-brand':'bg-black/20 border-transparent text-text-muted hover:border-surface-border'}`}>
              {icon}
              <span className="text-sm font-bold uppercase tracking-tight">{id}</span>
            </div>
          ))}
        </div>
      </BentoCard>

      <BentoCard className="md:col-span-9 md:row-span-5 !p-6 md:!p-10 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl w-full">
          <div className="mb-8">
            <h2 className="text-xl md:text-3xl font-black text-white">{settingsTab} Settings</h2>
            <p className="text-text-muted text-xs mt-1">Configure {settingsTab.toLowerCase()} parameters.</p>
          </div>
          <div className="space-y-5">
            {settingsTab==='General' && <>
              <div className="p-5 bg-black/40 rounded-2xl border border-surface-border">
                <p className="text-xs font-bold text-white mb-1">Data Directory</p>
                <p className="text-xs text-text-dim font-mono">~/.droidgrid/</p>
                <p className="text-[10px] text-text-dim/60 mt-1">Profiles, cameras, and session persisted here.</p>
              </div>
              <div className="p-5 bg-black/40 rounded-2xl border border-surface-border flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-white">Auto-check cameras</p>
                  <p className="text-[10px] text-text-dim mt-0.5">Probe all cameras every 30s</p>
                </div>
                <div className="w-10 h-5 bg-brand rounded-full p-0.5 cursor-pointer">
                  <div className="w-4 h-4 bg-white rounded-full translate-x-5 shadow-sm"/>
                </div>
              </div>
            </>}
            {settingsTab==='Session' && <>
              {([['Label','label'],['Person','person'],['Repeat','repeat'],['Pattern','pattern'],['Recording Dir','recordDir'],['Snapshots Dir','snapDir']] as [string,keyof SessionState][]).map(([label,key]) => (
                <div key={key} className="space-y-2">
                  <p className="text-[10px] text-text-dim uppercase font-black tracking-widest">{label}</p>
                  <input className="w-full bg-black/60 border border-surface-border rounded-xl p-3 text-sm font-mono text-brand focus:border-brand/40 outline-none transition-all"
                    value={session[key]} onChange={e=>saveSession({[key]:e.target.value})}/>
                </div>
              ))}
            </>}
            {settingsTab==='Networking' && <>
              <div className="p-5 bg-brand/5 border border-brand/20 rounded-2xl">
                <p className="text-[10px] text-brand uppercase font-bold tracking-widest mb-2 flex items-center gap-2">
                  <Wifi size={12}/> DroidCam streams via MJPEG HTTP
                </p>
                <p className="text-xs text-text-dim">Default port: 4747. Add your phone IPs in the Cameras tab.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-black/40 border border-surface-border rounded-xl">
                  <p className="text-[9px] text-text-dim uppercase font-bold">Server Port</p>
                  <p className="text-xs text-white mt-1 font-mono">3000</p>
                </div>
                <div className="p-4 bg-black/40 border border-surface-border rounded-xl">
                  <p className="text-[9px] text-text-dim uppercase font-bold">Camera Timeout</p>
                  <p className="text-xs text-white mt-1 font-mono">3000 ms</p>
                </div>
              </div>
            </>}
            {settingsTab==='Advanced' && <>
              <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl">
                <p className="text-[10px] text-red-400 uppercase font-black tracking-widest mb-2">Persistent Storage</p>
                <p className="text-[11px] text-red-300">All camera configurations and profiles are saved in ~/.droidgrid/ as JSON. You can edit them manually if needed.</p>
              </div>
              <div className="p-5 bg-black/40 border border-surface-border rounded-2xl">
                <p className="text-xs font-bold text-white mb-3">Recent Logs</p>
                <div className="font-mono text-[10px] text-text-muted space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                  {logs.slice(0,15).map(l => (
                    <p key={l.id} className="flex gap-2"><span className={logColour(l.level)}>[{l.time}]</span><span>{l.system}: {l.msg}</span></p>
                  ))}
                </div>
              </div>
            </>}
          </div>
        </div>
      </BentoCard>

      <BentoCard className="md:col-span-9 md:row-span-1 flex-row items-center justify-between !p-4 gap-4">
        <div className="flex items-center gap-2 text-brand/60">
          <ShieldCheck size={18}/>
          <span className="text-[10px] font-black uppercase tracking-widest">Config persisted to ~/.droidgrid/</span>
        </div>
        <button onClick={() => { setIsSaving(true); api.post('/api/settings/commit',{settingsTab}).then(()=>setTimeout(()=>setIsSaving(false),800)); }}
          disabled={isSaving}
          className="bg-brand hover:scale-[1.03] active:scale-95 text-black font-black px-6 py-2.5 rounded-xl text-xs uppercase tracking-widest transition-all shadow-xl shadow-brand/10 flex items-center gap-2 disabled:opacity-50">
          {isSaving ? <Activity size={14} className="animate-spin"/> : <Save size={14}/>}
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </BentoCard>
    </div>
  );

  // ── Discover ONVIF modal ──────────────────────────────────────────────────
  const DiscoverModal = () => {
    if (!showDiscoverModal) return null;

    const addDiscovered = async (cam: { address: string; rtsp_url?: string; name?: string }) => {
      const name = cam.name ?? `ONVIF-${Date.now()}`;
      const ipMatch = cam.address.match(/https?:\/\/([\d.]+)/);
      const ip = ipMatch?.[1] ?? cam.address;
      const added = await api.post('/api/cameras', {
        name, ip, port: 554, res: [1920, 1080], fps: 25, url: cam.rtsp_url ?? undefined,
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
            ><X size={20}/></button>
            <span className="text-brand text-xs font-mono uppercase tracking-[0.2em] mb-2 block">ONVIF Discovery</span>
            <h2 className="text-2xl font-black text-white">
              {discoveredCams.length} Camera{discoveredCams.length !== 1 ? 's' : ''} Found
            </h2>
          </div>

          <div className="p-6 max-h-80 overflow-y-auto custom-scrollbar">
            {discoveredCams.length === 0 ? (
              <p className="text-text-dim text-sm text-center py-6">No ONVIF cameras found on this network.</p>
            ) : (
              <div className="space-y-3">
                {discoveredCams.map((cam, i) => {
                  const alreadyAdded = cameras.some(c => c.ip && cam.address.includes(c.ip));
                  return (
                    <div key={i}
                      className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-surface-border">
                      <div>
                        <p className="text-xs text-white font-mono">{cam.name ?? `Camera ${i + 1}`}</p>
                        <p className="text-[9px] text-text-dim mt-0.5 truncate max-w-[260px]">{cam.address}</p>
                        {cam.rtsp_url && <p className="text-[9px] text-brand/60 mt-0.5 truncate max-w-[260px]">{cam.rtsp_url}</p>}
                      </div>
                      {alreadyAdded ? (
                        <span className="text-[9px] text-text-dim border border-surface-border px-2 py-1 rounded">Added</span>
                      ) : (
                        <button onClick={() => addDiscovered(cam)}
                          className="text-[9px] px-3 py-1.5 bg-brand/10 text-brand rounded border border-brand/20 hover:bg-brand/20 transition-all">
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
            <button onClick={() => setShowDiscoverModal(false)}
              className="w-full bg-surface-border/50 text-text-dim hover:text-white py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">
              Close
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  // ── Profile detail modal ───────────────────────────────────────────────────
  const ProfileModal = () => {
    if (!selectedProfile) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={()=>setSelectedProfile(null)}>
        <motion.div initial={{scale:0.9,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.9,opacity:0}}
          className="bg-surface-card border border-surface-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
          onClick={e=>e.stopPropagation()}>
          <div className="p-8 border-b border-surface-border relative">
            <button onClick={()=>setSelectedProfile(null)} className="absolute top-6 right-6 text-text-dim hover:text-white p-2 rounded-full hover:bg-white/5 transition-all"><X size={20}/></button>
            <span className="text-brand text-xs font-mono uppercase tracking-[0.2em] mb-2 block">Saved Profile</span>
            <h2 className="text-3xl font-black text-white">{selectedProfile.name}</h2>
            <p className="text-text-muted text-sm mt-1">{selectedProfile.cameras.length} cameras · {new Date(selectedProfile.createdAt).toLocaleDateString()}</p>
          </div>
          <div className="p-8 bg-black/20">
            <h4 className="text-[10px] text-text-dim uppercase font-bold tracking-widest mb-4">Session Config</h4>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(selectedProfile.session).map(([k,v])=>(
                <div key={k} className="flex flex-col p-3 bg-black/40 rounded-xl border border-surface-border">
                  <span className="text-[9px] text-text-muted capitalize">{k.replace(/([A-Z])/g,' $1')}</span>
                  <span className="text-xs font-mono text-brand mt-0.5 truncate">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-8 grid grid-cols-2 gap-4 bg-black/40">
            <button onClick={()=>loadProfile(selectedProfile.id)}
              className="bg-brand text-black font-black py-3 rounded-2xl text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all">
              Load Profile
            </button>
            <button onClick={()=>deleteProfile(selectedProfile.id, selectedProfile.name)}
              className="bg-red-950/30 border border-red-900/30 text-red-400 font-bold py-3 rounded-2xl text-xs uppercase tracking-widest hover:bg-red-900/20 transition-all">
              Delete
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-surface-bg text-[#fafafa] font-sans p-4 md:p-6 flex flex-col gap-4 max-w-[1600px] mx-auto overflow-x-hidden">
      {/* Nav */}
      <nav className="flex items-center justify-between border border-surface-border bg-surface-card rounded-xl px-4 md:px-6 py-4 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center text-black font-black italic shadow-[0_0_15px_rgba(61,220,132,0.3)]">D</div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            DroidGrid <span className="text-text-dim font-normal text-sm hidden sm:inline">v2.4.0-pro</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-6 text-xs font-medium text-text-dim uppercase tracking-widest">
              {(['dashboard','cameras','extensions','settings'] as const).map(v=>(
              <span key={v} onClick={()=>setView(v)}
                className={`${view===v?'text-brand border-b-2 border-brand':'hover:text-white'} pb-1 cursor-pointer transition-all capitalize`}>
                {v}
              </span>
            ))}
          </div>
          <div className="h-8 w-[1px] bg-surface-border hidden md:block"/>
          <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-surface-border">
            <div className={`w-2 h-2 rounded-full ${onlineCount>0?'bg-brand animate-pulse':'bg-red-500'}`}/>
            <span className="text-[10px] text-text-muted font-mono whitespace-nowrap uppercase">{onlineCount}/{cameras.length} LIVE</span>
          </div>
          {recording && (
            <div className="flex items-center gap-2 bg-red-950/40 px-3 py-1.5 rounded-full border border-red-900/50 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-red-500"/>
              <span className="text-[10px] text-red-400 font-mono uppercase">REC {fmtTime(recElapsed)}</span>
            </div>
          )}
        </div>
      </nav>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div key={view} initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}} transition={{duration:0.2}} className="flex-1 flex flex-col gap-4">
          {view==='dashboard'   && renderDashboard()}
          {view==='cameras'     && renderCameras()}
          {view==='extensions'  && renderExtensions()}
          {view==='settings'    && renderSettings()}
        </motion.div>
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>{selectedProfile && <ProfileModal/>}</AnimatePresence>
      <AnimatePresence>{showDiscoverModal && <DiscoverModal/>}</AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,y:20}}
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border ${toast.ok?'bg-brand/10 border-brand/30 text-brand':'bg-red-950/40 border-red-900/30 text-red-400'}`}>
            {toast.ok ? <CheckCircle size={16}/> : <AlertCircle size={16}/>}
            <span className="text-sm font-medium">{toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="flex flex-col md:flex-row items-center justify-between px-4 py-4 md:py-3 text-[10px] text-text-dim font-mono tracking-widest bg-surface-card border border-surface-border rounded-xl gap-2 md:gap-0 mt-auto">
        <div className="flex gap-6">
          <span>CAMERAS: <span className={onlineCount>0?'text-brand':'text-red-400'}>{onlineCount}/{cameras.length} ONLINE</span></span>
          <span className="flex items-center gap-2"><Clock size={10}/> UPTIME: {Math.floor(performance.now()/1000)}s</span>
        </div>
        <div className="flex gap-6">
          <span className="flex items-center gap-2"><ShieldCheck size={10} className="text-brand"/> VISION-ORCHESTRATION</span>
          <span>DATA: ~/.droidgrid/</span>
        </div>
      </footer>
    </div>
  );
}
