/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Cpu, Battery, Thermometer, ShieldCheck, Database, Terminal, Wifi, 
  Settings, Activity, HardDrive, Smartphone, Zap, Clock, Search, 
  File, Folder, Download, Trash2, Save, Globe, Lock, Share2, ChevronRight, X 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const BentoCard = ({ children, className = "", title, sub }: { children: React.ReactNode; className?: string; title?: string; sub?: string }) => (
  <div className={`bg-surface-card border border-surface-border rounded-2xl p-5 flex flex-col relative overflow-hidden transition-all hover:border-brand/40 group ${className}`}>
    {(title || sub) && (
      <div className="flex flex-col gap-1 mb-4 z-10">
        {sub && <span className="text-brand text-[10px] font-mono uppercase tracking-tighter">{sub}</span>}
        {title && <h3 className="text-sm font-bold text-text-dim uppercase tracking-widest">{title}</h3>}
      </div>
    )}
    <div className="flex-1 flex flex-col overflow-hidden">
      {children}
    </div>
  </div>
);

export default function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'explorer' | 'settings'>('dashboard');
  const [settingsTab, setSettingsTab] = useState('General');
  const [explorerTab, setExplorerTab] = useState('sdcard');
  const [selectedProfile, setSelectedProfile] = useState<null | { name: string, status: string, active?: boolean, config: any }>(null);
  const [deviceStats, setDeviceStats] = useState({ cpu: '0%', temp: '0°C', battery: '0%' });
  const [logs, setLogs] = useState<any[]>([]);
  const [explorerFiles, setExplorerFiles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Profile Detail Modal
  const ProfileModal = ({ profile, onClose }: { profile: any, onClose: () => void }) => (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-surface-card border border-surface-border w-full max-w-lg rounded-3xl p-8 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <span className="text-[10px] text-brand font-black uppercase tracking-[0.2em] mb-1 block">Active configuration</span>
            <h3 className="text-3xl font-black text-white">{profile.name}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-dim"><X size={20} /></button>
        </div>
        
        <div className="grid grid-cols-1 gap-3 mb-8">
          {Object.entries(profile.config).map(([key, val]: [string, any]) => (
            <div key={key} className="flex justify-between items-center p-4 bg-black/40 rounded-2xl border border-surface-border/50">
              <span className="text-xs text-text-muted capitalize">{key.replace(/_/g, ' ')}</span>
              <span className="text-xs font-mono text-brand font-bold uppercase">{String(val)}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-4">
          <button className="flex-1 bg-brand text-black font-black py-4 rounded-2xl text-xs uppercase tracking-widest shadow-lg shadow-brand/10 hover:scale-[1.02] transition-transform">Apply To Kernel</button>
          <button onClick={onClose} className="px-8 border border-surface-border text-white text-xs font-bold rounded-2xl hover:bg-white/5">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );

  // REAL-TIME DATA FETCHING
  React.useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        const fetchUrl = (path: string) => {
          // Robust path resolution
          return path.startsWith('/') ? path : `/${path}`;
        };

        const [statsRes, logsRes, filesRes] = await Promise.all([
          fetch(fetchUrl(`/api/device/stats`)),
          fetch(fetchUrl(`/api/logs`)),
          fetch(fetchUrl(`/api/explorer/files?cat=${explorerTab}`))
        ]);
        
        if (!isMounted) return;

        if (statsRes.ok) setDeviceStats(await statsRes.json());
        if (logsRes.ok) setLogs(await logsRes.json());
        if (filesRes.ok) setExplorerFiles(await filesRes.json());
        
        setIsLoading(false);
      } catch (err) {
        if (isMounted) {
          console.error("Backend sync failed (Retrying...):", err);
          // Keep isLoading true if we haven't succeeded yet
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000); 
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [explorerTab]); // Re-fetch when category changes

  const profiles = [
    { 
      name: 'Gaming_Mode_v2', 
      status: 'ACTIVE', 
      active: true,
      config: {
        thermal_throttle: 'Disabled',
        gpu_boost: 'Max Performance',
        background_limit: '0 Processes',
        screen_hertz: '120Hz',
        low_latency_audio: 'Enabled'
      }
    },
    { 
      name: 'Work_Minimal', 
      status: 'IDLE',
      config: {
        thermal_throttle: 'Optimized',
        gpu_boost: 'Dynamic',
        background_limit: 'Standard',
        screen_hertz: '60Hz',
        blue_light_filter: 'Active'
      }
    },
    { 
      name: 'Secure_Sandbox', 
      status: 'IDLE',
      config: {
        encryption_level: 'AES-512',
        vpn_tunnel: 'Always-On',
        network_isolation: 'Strict',
        biometric_only: 'Enabled'
      }
    },
    { 
      name: 'Debloat_Script_R3', 
      status: 'IDLE',
      config: {
        remove_telemetry: 'True',
        disable_ads: 'Global',
        untrack_usage: 'True',
        clean_cache_on_exit: 'True'
      }
    }
  ];

  const [isSaving, setIsSaving] = useState(false);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await fetch('/api/settings/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settingsTab, timestamp: Date.now() })
      });
      // Simulate verification delay
      setTimeout(() => setIsSaving(false), 800);
    } catch (e) {
      console.error(e);
      setIsSaving(false);
    }
  };

  const renderDashboard = () => (
    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 md:grid-rows-6 gap-4">
      {/* Active Device Card (Large) */}
      <BentoCard className="md:col-span-8 md:row-span-3 !p-6 md:!p-8" sub="Connected via Wireless Bridge">
        <div className="absolute top-0 right-0 p-8 opacity-[0.03] -rotate-12 pointer-events-none group-hover:opacity-[0.07] transition-opacity">
          <Smartphone size={320} />
        </div>
        <div className="z-10 flex flex-col h-full">
          <h2 className="text-3xl md:text-6xl font-black mb-2 text-white">Pixel 8 Pro</h2>
          <p className="text-text-muted text-xs md:text-base italic flex items-center gap-2">
            <Zap size={14} className="text-brand" /> Tensor G3 • 12GB LPDDR5X • Android 14 (U)
          </p>
          
          <div className="mt-auto grid grid-cols-1 sm:grid-cols-3 gap-4 pt-10 md:pt-12">
            {[
              { label: 'CPU Load', value: deviceStats.cpu, icon: <Cpu className="text-brand" size={16} /> },
              { label: 'Temp', value: deviceStats.temp, icon: <Thermometer className={parseInt(deviceStats.temp) > 35 ? "text-orange-500" : "text-brand"} size={16} />, sub: parseInt(deviceStats.temp) > 35 ? 'Warning' : 'Optimal' },
              { label: 'Battery', value: deviceStats.battery, icon: <Battery className="text-brand" size={16} /> }
            ].map((stat, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-black/40 border border-surface-border rounded-xl p-4 hover:border-brand/20 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-text-dim uppercase font-bold tracking-widest">{stat.label}</span>
                  {stat.icon}
                </div>
                <p className="text-xl md:text-2xl font-mono text-white">{stat.value}</p>
                {stat.sub && <span className={`text-[10px] uppercase ${stat.sub === 'Warning' ? 'text-orange-400' : 'text-brand/60'}`}>{stat.sub}</span>}
              </motion.div>
            ))}
          </div>
        </div>
      </BentoCard>

      {/* Quick Actions (Medium) */}
      <BentoCard title="Batch Actions" className="md:col-span-4 md:row-span-2">
        <div className="flex flex-col gap-3 h-full justify-center">
          <button className="w-full bg-brand hover:bg-brand/90 text-black font-bold py-2.5 rounded-lg text-sm transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-brand/10">
            Start Profile Sync
          </button>
          <button className="w-full bg-surface-border/50 hover:bg-surface-border text-white py-2.5 rounded-lg text-sm border border-surface-border transition-all">
            Dump System Logs
          </button>
          <button className="w-full bg-red-950/20 hover:bg-red-900/30 text-red-400 py-2.5 rounded-lg text-sm border border-red-900/30 transition-all">
            Force Reboot Bootloader
          </button>
        </div>
      </BentoCard>

      {/* Storage Overview (Medium) */}
      <BentoCard className="md:col-span-4 md:row-span-1 flex-row items-center gap-5">
        <div className="relative w-12 h-12 md:w-14 md:h-14 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
            <circle
              className="stroke-surface-border fill-none"
              strokeWidth="3.5"
              cx="18" cy="18" r="16"
            />
            <circle
              className="stroke-brand fill-none transition-all duration-1000"
              strokeWidth="3.5"
              strokeDasharray="72, 100"
              strokeLinecap="round"
              cx="18" cy="18" r="16"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] md:text-[11px] font-bold">72%</span>
          </div>
        </div>
        <div>
          <h4 className="text-xs md:text-sm font-bold flex items-center gap-2">
            <HardDrive size={14} className="text-brand" /> Storage Util
          </h4>
          <p className="text-[10px] md:text-xs text-text-muted">92.4GB of 128GB used</p>
        </div>
      </BentoCard>

      {/* Saved Profiles (Vertical) */}
      <BentoCard title="Database Profiles" className="md:col-span-4 md:row-span-3">
        <div className="absolute top-4 right-4 group-hover:rotate-6 transition-transform">
           <span className="text-[8px] md:text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full border border-brand/20">{profiles.length} Total</span>
        </div>
        <div className="flex-1 overflow-y-auto mt-2 pr-1 custom-scrollbar">
          <div className="flex flex-col gap-2.5">
            {profiles.map((p, i) => (
              <button 
                key={i} 
                onClick={() => setSelectedProfile(p)}
                className={`p-3 rounded-xl border transition-all flex justify-between items-center text-left group/profile ${p.active ? 'bg-brand/5 border-brand/30 shadow-inner' : 'bg-black/20 border-surface-border opacity-60 hover:opacity-100 hover:border-surface-border/80'}`}
              >
                <div className="flex flex-col">
                  <span className={`text-xs md:text-sm font-medium ${p.active ? 'text-white' : 'text-text-muted'}`}>{p.name}</span>
                  <span className="text-[8px] md:text-[9px] text-text-dim flex items-center gap-1 opacity-0 group-hover/profile:opacity-100 transition-opacity whitespace-nowrap">
                    <ChevronRight size={8} /> View Configuration
                  </span>
                </div>
                <span className={`text-[8px] md:text-[9px] font-mono tracking-tighter h-fit px-1.5 py-0.5 rounded ${p.active ? 'bg-brand text-black font-bold' : 'text-text-dim'}`}>
                  {p.status}
                </span>
              </button>
            ))}
          </div>
        </div>
        <button className="mt-4 text-center text-[10px] md:text-xs text-text-dim hover:text-white py-3 border-t border-surface-border transition-colors">
          + Create New Profile
        </button>
      </BentoCard>

      {/* Real-time Log Stream (Wide) */}
      <BentoCard title="Real-time Log Stream" className="md:col-span-5 md:row-span-3">
        <div className="flex-1 font-mono text-[9px] md:text-[11px] text-text-muted overflow-hidden space-y-1.5 bg-black/40 p-4 rounded-xl border border-surface-border shadow-inner">
          {logs.slice(0, 7).map((log) => (
            <p key={log.id} className="flex gap-2 truncate">
              <span className={log.color}>[{log.time}]</span> 
              <span className="text-white hidden sm:inline">{log.system}:</span> {log.msg}
            </p>
          ))}
          <p className="flex gap-2 opacity-40 animate-pulse-slow">
            <span className="text-brand">[{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span> 
            <span className="text-white hidden sm:inline">LISTEN:</span> Waiting for shell...
          </p>
        </div>
      </BentoCard>

      {/* Data Metrics (Small) */}
      <BentoCard title="Data Transfer" className="md:col-span-3 md:row-span-3 justify-between">
        <div className="z-10">
          <div className="text-xl md:text-3xl font-mono text-white">
            {(400 + Math.random() * 100).toFixed(0)} <span className="text-xs text-text-muted">MB/s</span>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Activity size={10} className="text-brand" />
            <span className="text-[8px] md:text-[10px] text-brand uppercase font-bold">Encrypted Link</span>
          </div>
        </div>
        
        <div className="h-12 md:h-16 flex items-end gap-1 px-1">
          {[20, 40, 60, 80, 100, 70, 30].map((h, i) => (
            <motion.div 
              key={i}
              initial={{ height: 0 }}
              animate={{ height: `${h}%` }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
              className="flex-1 bg-brand rounded-t-sm"
              style={{ opacity: (i + 1) * 0.15 }}
            />
          ))}
        </div>
        
        <div className="flex justify-between text-[8px] md:text-[10px] text-text-dim font-mono border-t border-surface-border pt-2 mt-2">
          <span>UP: 1.2GB</span>
          <span>DOWN: 4.8GB</span>
        </div>
      </BentoCard>
    </div>
  );

  const renderExplorer = () => (
    <div className="flex-1 flex flex-col md:grid md:grid-cols-12 md:grid-rows-6 gap-4">
      {/* Mobile Sub-Nav */}
      <div className="md:hidden flex overflow-x-auto gap-2 pb-2 custom-scrollbar">
        {[
          { id: 'sdcard', label: 'sdcard', icon: <Folder size={14} /> },
          { id: 'system', label: 'system', icon: <Cpu size={14} /> },
          { id: 'apps', label: 'apps', icon: <Smartphone size={14} /> },
          { id: 'logs', label: 'logs', icon: <Terminal size={14} /> },
          { id: 'config', label: 'config', icon: <Database size={14} /> },
        ].map(item => (
          <button 
            key={item.id}
            onClick={() => setExplorerTab(item.id)}
            className={`flex items-center gap-2 p-2 rounded-xl text-xs whitespace-nowrap border ${explorerTab === item.id ? 'bg-brand/10 border-brand/20 text-brand' : 'bg-surface-card border-surface-border text-text-dim'}`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      {/* File Tree Sidebar (Desktop Only) */}
      <BentoCard title="Device Storage" className="hidden md:flex md:col-span-3 md:row-span-6">
        <div className="bg-black/20 rounded-lg p-2 mb-4 border border-surface-border flex items-center gap-2">
          <Search size={14} className="text-text-dim" />
          <input type="text" placeholder="Filter node..." className="bg-transparent text-xs w-full outline-none text-white" />
        </div>
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto pr-2 custom-scrollbar">
          {[
            { id: 'root', label: 'Root Directory', icon: <ChevronRight size={14} /> },
            { id: 'sdcard', label: 'sdcard', icon: <Folder size={14} />, indent: true },
            { id: 'system', label: 'system', icon: <Folder size={14} />, indent: true },
            { id: 'data', label: 'data', icon: <Folder size={14} />, indent: true },
            { id: 'apps', label: 'apps (pkg)', icon: <Smartphone size={14} />, indent: true },
            { id: 'logs', label: 'system_logs', icon: <Terminal size={14} />, indent: true },
          ].map((item, i) => (
            <div 
              key={i} 
              onClick={() => setExplorerTab(item.id)}
              className={`flex items-center gap-2 p-2 rounded flex-shrink-0 lg:p-2.5 rounded-lg text-[10px] lg:text-xs cursor-pointer hover:bg-brand/5 transition-colors ${item.indent ? 'ml-4' : ''} ${explorerTab === item.id ? 'text-brand font-bold bg-brand/5' : 'text-text-muted'}`}
            >
              {item.icon}
              {item.label}
            </div>
          ))}
        </div>
      </BentoCard>

      {/* Main File Browser */}
      <BentoCard className="md:col-span-9 md:row-span-5 !p-0 overflow-hidden min-h-[400px]">
        <div className="border-b border-surface-border p-4 md:px-6 md:py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between bg-black/10 gap-3">
          <div className="flex items-center gap-3">
             <div className="bg-surface-border/50 p-2 rounded-lg">
                {explorerTab === 'apps' ? <Smartphone size={18} className="text-brand" /> : <Folder size={18} className="text-brand" />}
             </div>
             <div>
                <h3 className="text-xs md:text-sm font-bold text-white">/{explorerTab === 'root' ? '' : explorerTab}/...</h3>
                <p className="text-[8px] md:text-[10px] text-text-muted uppercase tracking-widest">{explorerFiles.length} items discovered</p>
             </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
             <button className="flex-1 sm:flex-none justify-center bg-surface-border hover:bg-brand text-white hover:text-black p-2 md:p-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 text-xs">
               <Download size={14} /> <span className="sm:hidden">Download</span>
             </button>
             <button className="flex-1 sm:flex-none justify-center bg-red-950/20 text-red-400 p-2 md:p-2.5 rounded-xl border border-red-900/30 hover:bg-red-900/10 transition-all flex items-center gap-2 text-xs">
               <Trash2 size={14} /> <span className="sm:hidden">Delete</span>
             </button>
          </div>
        </div>
        
        <div className="p-4 md:p-6 overflow-x-auto overflow-y-auto max-h-[calc(100%-80px)] custom-scrollbar">
          <table className="w-full text-left min-w-[500px]">
            <thead>
              <tr className="text-[8px] md:text-[10px] text-text-dim uppercase tracking-widest border-b border-surface-border">
                <th className="pb-4 font-black">Entity Name</th>
                <th className="pb-4 font-black">Allocation</th>
                <th className="pb-4 font-black">Classification</th>
                <th className="pb-4 font-black">Permissions</th>
              </tr>
            </thead>
            <tbody className="text-[10px] md:text-xs">
              {explorerFiles.map((file, i) => (
                <tr key={i} className="group hover:bg-white/[0.03] transition-colors border-b border-surface-border/30">
                  <td className="py-4 flex items-center gap-3 text-white truncate max-w-[200px]">
                    <File size={14} className="text-text-dim group-hover:text-brand transition-colors shrink-0" />
                    {file.name}
                  </td>
                  <td className="py-4 font-mono text-text-muted">{file.size}</td>
                  <td className="py-4">
                    <span className="bg-white/5 border border-surface-border px-1.5 md:px-2 py-0.5 rounded text-text-muted text-[8px] md:text-[10px]">{file.type}</span>
                  </td>
                  <td className="py-4 font-mono text-text-dim">{file.perms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BentoCard>

      {/* Context Actions */}
      <BentoCard className="md:col-span-9 md:row-span-1 flex-row items-center gap-3 overflow-x-auto p-4 custom-scrollbar">
         <div className="flex flex-1 gap-2 whitespace-nowrap">
            {['Copy Path', 'Open Terminal', 'Deep Scan', 'Purge Cache'].map(action => (
              <button key={action} className="text-[8px] md:text-[10px] text-text-dim bg-surface-border/30 hover:bg-surface-border/60 px-2.5 md:px-3 py-1.5 rounded-lg border border-surface-border/50 transition-all font-bold">
                {action}
              </button>
            ))}
         </div>
         <div className="flex shrink-0 items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse"></div>
            <span className="text-[8px] md:text-[10px] text-brand font-mono uppercase tracking-widest font-bold">STABLE</span>
         </div>
      </BentoCard>
    </div>
  );

  const renderSettings = () => (
    <div className="flex-1 flex flex-col md:grid md:grid-cols-12 md:grid-rows-6 gap-4">
      {/* Mobile Settings Nav */}
      <div className="md:hidden flex overflow-x-auto gap-2 pb-2 custom-scrollbar">
        {[
          { id: 'General', icon: <Settings size={14} /> },
          { id: 'Security', icon: <Lock size={14} /> },
          { id: 'Networking', icon: <Globe size={14} /> },
          { id: 'Sync', icon: <Share2 size={14} /> },
          { id: 'Advanced', icon: <Terminal size={14} /> },
        ].map(item => (
          <button 
            key={item.id}
            onClick={() => setSettingsTab(item.id)}
            className={`flex items-center gap-2 p-2.5 rounded-xl text-xs whitespace-nowrap border ${settingsTab === item.id ? 'bg-brand/10 border-brand/20 text-brand' : 'bg-surface-card border-surface-border text-text-dim'}`}
          >
            {item.icon} {item.id}
          </button>
        ))}
      </div>

      {/* Category Selection (Desktop) */}
      <BentoCard title="Settings Hub" className="hidden md:flex md:col-span-3 md:row-span-6">
        <div className="flex flex-col gap-2 mt-2">
          {[
            { id: 'General', label: 'General', icon: <Settings size={14} /> },
            { id: 'Security', label: 'Security', icon: <Lock size={14} /> },
            { id: 'Networking', label: 'Networking', icon: <Globe size={14} /> },
            { id: 'Sync', label: 'Cloud Sync', icon: <Share2 size={14} /> },
            { id: 'Advanced', label: 'Advanced', icon: <Terminal size={14} /> },
          ].map((item, i) => (
            <div 
              key={i} 
              onClick={() => setSettingsTab(item.id)}
              className={`flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer transition-all border ${settingsTab === item.id ? 'bg-brand/5 border-brand/20 text-brand' : 'bg-black/20 border-transparent text-text-muted hover:border-surface-border'}`}
            >
              {item.icon}
              <span className="text-sm font-bold uppercase tracking-tight">{item.label}</span>
            </div>
          ))}
        </div>
      </BentoCard>

      {/* Main Settings Panel */}
      <BentoCard className={`md:col-span-9 md:row-span-5 !p-6 md:!p-10 overflow-y-auto custom-scrollbar`}>
        <div className="max-w-2xl w-full">
          <div className="mb-6 md:mb-10">
            <h2 className="text-xl md:text-3xl font-black text-white">{settingsTab} Preferences</h2>
            <p className="text-text-muted text-[10px] md:text-sm mt-1">Configure {settingsTab.toLowerCase()} parameters and automation logic.</p>
          </div>
          
          <div className="space-y-4 md:space-y-6">
            {settingsTab === 'General' && (
              <>
                {[
                  { label: 'Auto-Sync Profiles', desc: 'Sync local database with cloud storage clusters', active: true },
                  { label: 'Wireless ADB Bridge', desc: 'Attempt WLAN connection on initialization', active: false },
                  { label: 'Hardware Acceleration', desc: 'Use GPU for dashboard rendering', active: true },
                ].map((setting, i) => (
                  <div key={i} className="flex items-center justify-between p-4 md:p-5 bg-black/40 rounded-2xl border border-surface-border hover:border-surface-border/80 transition-colors">
                    <div>
                      <p className="text-xs md:text-sm font-bold text-white">{setting.label}</p>
                      <p className="text-[8px] md:text-xs text-text-dim mt-0.5">{setting.desc}</p>
                    </div>
                    <div className={`w-10 h-5 md:w-11 md:h-6 rounded-full relative cursor-pointer p-1 transition-colors ${setting.active ? 'bg-brand' : 'bg-surface-border'}`}>
                      <div className={`w-3 h-3 md:w-4 md:h-4 bg-white rounded-full transition-transform shadow-sm ${setting.active ? 'translate-x-5' : 'translate-x-0'}`}></div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {settingsTab === 'Security' && (
              <>
                <div className="p-5 bg-black/40 rounded-2xl border border-surface-border hover:border-brand/20 transition-all flex items-center gap-4">
                   <div className="p-3 bg-brand/10 rounded-xl"><Lock className="text-brand" size={24} /></div>
                   <div>
                      <h4 className="text-sm font-bold text-white">Full-Disk Encryption</h4>
                      <p className="text-xs text-text-dim">Status: AES-256-GCM Active</p>
                   </div>
                </div>
                <div className="space-y-3 pt-2">
                   <p className="text-[10px] text-text-dim uppercase font-black tracking-widest">Biometric Lockout Delay</p>
                   <select className="w-full bg-black/60 border border-surface-border rounded-xl p-3 md:p-4 text-xs md:text-sm text-text-muted outline-none focus:border-brand/40 transition-all appearance-none cursor-pointer">
                      <option>Immediate</option>
                      <option>5 Minutes</option>
                      <option>1 Hour</option>
                    </select>
                </div>
              </>
            )}

            {settingsTab === 'Networking' && (
              <>
                <div className="space-y-4">
                  <div className="p-5 bg-brand/5 border border-brand/20 rounded-2xl">
                     <p className="text-[10px] text-brand uppercase font-bold tracking-widest mb-2 flex items-center gap-2">
                       <Wifi size={12} /> Active Bridge: WLAN_0 (192.168.1.42)
                     </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 bg-black/40 border border-surface-border rounded-xl">
                       <p className="text-[9px] text-text-dim uppercase font-bold">Proxy Tunnel</p>
                       <p className="text-xs text-white mt-1">DIRECT-LINK</p>
                    </div>
                    <div className="p-4 bg-black/40 border border-surface-border rounded-xl">
                       <p className="text-[9px] text-text-dim uppercase font-bold">MTU Size</p>
                       <p className="text-xs text-white mt-1">1500 BYTES</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {settingsTab === 'Sync' && (
              <div className="text-center py-10">
                 <Database className="mx-auto text-brand/20 mb-4" size={48} />
                 <h4 className="text-white font-bold">Cloud Cluster Alpha</h4>
                 <p className="text-text-muted text-xs mt-1">Last synced 2 minutes ago</p>
                 <button className="mt-6 bg-brand/10 text-brand border border-brand/30 px-6 py-2 rounded-xl text-xs font-bold hover:bg-brand hover:text-black transition-all">
                    Force Cloud Refresh
                 </button>
              </div>
            )}

            {settingsTab === 'Advanced' && (
              <div className="space-y-4">
                <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl">
                   <p className="text-[10px] text-red-400 uppercase font-black tracking-widest mb-2">Developer Warning</p>
                   <p className="text-[11px] text-red-300">Modifying kernel-level parameters can result in device fragmentation or data loss. Proceed with extreme caution.</p>
                </div>
                <div className="flex items-center justify-between p-4 bg-black/40 border border-surface-border rounded-xl">
                   <span className="text-xs text-white font-bold">Kernel Logging (Verbose)</span>
                   <div className="w-10 h-5 bg-surface-border rounded-full p-1"><div className="w-3 h-3 bg-white/20 rounded-full"></div></div>
                </div>
              </div>
            )}

            {(settingsTab === 'General' || settingsTab === 'Networking') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 pt-4">
                <div className="space-y-3">
                  <p className="text-[10px] text-text-dim uppercase font-black tracking-widest">ADB Server Port</p>
                  <div className="relative group">
                    <input type="text" defaultValue="5554" className="w-full bg-black/60 border border-surface-border rounded-xl p-3 md:p-4 text-xs md:text-sm font-mono text-brand focus:border-brand/40 outline-none transition-all shadow-inner" />
                    <div className="absolute right-4 top-3.5 md:top-4 text-text-dim opacity-0 group-hover:opacity-100 transition-opacity"><Settings size={14} /></div>
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] text-text-dim uppercase font-black tracking-widest">Protocol Stack</p>
                  <select className="w-full bg-black/60 border border-surface-border rounded-xl p-3 md:p-4 text-xs md:text-sm text-text-muted outline-none focus:border-brand/40 transition-all appearance-none cursor-pointer">
                    <option>Standard (TCP/IP)</option>
                    <option>Low Latency (UDP)</option>
                    <option>Relay (Proxied)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </BentoCard>

      {/* Save Strip */}
      <BentoCard className="md:col-span-9 md:row-span-1 flex-col sm:flex-row items-center justify-between !p-4 md:!p-6 gap-4">
        <div className="flex gap-2 w-full sm:w-auto">
           <div className="flex items-center gap-2 text-brand/60 mx-auto sm:mx-0">
              <ShieldCheck size={18} />
              <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Verified User Access</span>
           </div>
        </div>
        <div className="flex gap-3 md:gap-4 w-full sm:w-auto">
           <button className="flex-1 sm:flex-none text-[10px] md:text-xs text-text-dim hover:text-white font-bold transition-colors">Discard</button>
           <button 
             onClick={handleSaveSettings}
             disabled={isSaving}
             className="flex-2 sm:flex-none bg-brand hover:scale-[1.03] active:scale-95 text-black font-black px-6 md:px-8 py-2.5 md:py-3 rounded-xl text-[10px] md:text-xs uppercase tracking-widest transition-all shadow-xl shadow-brand/10 flex items-center justify-center gap-2 disabled:opacity-50"
           >
              {isSaving ? <Activity size={16} className="animate-spin" /> : <Save size={16} />} 
              {isSaving ? 'Verifying...' : 'Update Core'}
           </button>
        </div>
      </BentoCard>
    </div>
  );


  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-bg flex items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-xs w-full"
        >
          <div className="w-16 h-16 border-t-2 border-brand rounded-full animate-spin mx-auto mb-6 shadow-[0_0_20px_rgba(61,220,132,0.2)]"></div>
          <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">Bridge Init</h2>
          <p className="text-text-muted text-xs font-mono">AUTHENTICATING HANDSHAKE...<br/>SYNCING KERNEL MODULES</p>
          <div className="mt-8 bg-surface-border/30 h-1 rounded-full overflow-hidden">
            <motion.div 
               animate={{ x: [-100, 300] }}
               transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
               className="bg-brand w-1/3 h-full shadow-[0_0_10px_#3ddc84]"
            />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-bg text-[#fafafa] font-sans p-4 md:p-6 flex flex-col gap-4 max-w-[1600px] mx-auto overflow-x-hidden">
      {/* Top Navigation Bar */}
      <nav className="flex items-center justify-between border border-surface-border bg-surface-card rounded-xl px-4 md:px-6 py-4 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center text-black font-black italic shadow-[0_0_15px_rgba(61,220,132,0.3)]">D</div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            DroidGrid <span className="text-text-dim font-normal text-sm hidden sm:inline">v2.4.0-pro</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-6 text-xs font-medium text-text-dim uppercase tracking-widest">
            <span 
              onClick={() => setCurrentView('dashboard')}
              className={`${currentView === 'dashboard' ? 'text-brand border-b-2 border-brand' : 'hover:text-white'} pb-1 cursor-pointer transition-all`}
            >
              Dashboard
            </span>
            <span 
               onClick={() => setCurrentView('explorer')}
               className={`${currentView === 'explorer' ? 'text-brand border-b-2 border-brand' : 'hover:text-white'} pb-1 cursor-pointer transition-all`}
            >
              Explorer
            </span>
            <span 
               onClick={() => setCurrentView('settings')}
               className={`${currentView === 'settings' ? 'text-brand border-b-2 border-brand' : 'hover:text-white'} pb-1 cursor-pointer transition-all`}
            >
              Settings
            </span>
          </div>
          <div className="h-8 w-[1px] bg-surface-border hidden md:block"></div>
          <div className="flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-full border border-surface-border group cursor-help relative">
            <div className="w-2 h-2 rounded-full bg-brand animate-pulse"></div>
            <span className="text-[10px] text-text-muted font-mono whitespace-nowrap uppercase">ADB: {currentView === 'dashboard' ? 'ENABLED' : 'STBY'} [5554]</span>
            <div className="absolute top-full mt-2 right-0 bg-surface-card border border-surface-border p-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-[9px] w-48 shadow-2xl z-50">
               <p className="text-white mb-1">ADB Connection Active</p>
               <p className="text-text-dim">Protocol: v24.2.1 Secure Bridge Target: Pixel_8_Pro (5554)</p>
            </div>
          </div>
        </div>
      </nav>

      {/* Content Switcher */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="flex-1 flex flex-col gap-4"
        >
          {currentView === 'dashboard' && renderDashboard()}
          {currentView === 'explorer' && renderExplorer()}
          {currentView === 'settings' && renderSettings()}
        </motion.div>
      </AnimatePresence>

      {/* Profile Detail Overlay */}
      <AnimatePresence>
        {selectedProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-card border border-surface-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-surface-border relative">
                 <button 
                  onClick={() => setSelectedProfile(null)}
                  className="absolute top-6 right-6 text-text-dim hover:text-white p-2 rounded-full hover:bg-white/5 transition-all outline-none"
                 >
                   <X size={20} />
                 </button>
                 <span className="text-brand text-xs font-mono uppercase tracking-[0.2em] mb-2 block animate-pulse">System Profile</span>
                 <h2 className="text-3xl font-black text-white">{selectedProfile.name}</h2>
                 <p className="text-text-muted text-sm mt-1">Status: <span className={selectedProfile.status === 'ACTIVE' ? 'text-brand' : 'text-text-dim'}>{selectedProfile.status}</span></p>
              </div>
              
              <div className="p-8 bg-black/20">
                <h4 className="text-[10px] text-text-dim uppercase font-bold tracking-widest mb-4">Configuration Data</h4>
                <div className="grid grid-cols-1 gap-3">
                  {Object.entries(selectedProfile.config).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-surface-border group hover:border-brand/20 transition-colors">
                       <span className="text-xs uppercase text-text-muted font-mono">{key.replace(/_/g, ' ')}</span>
                       <span className="text-xs font-bold text-white bg-brand/10 px-2 py-1 rounded border border-brand/20 group-hover:bg-brand/20 transition-colors">{value as string}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="p-8 grid grid-cols-2 gap-4 bg-black/40">
                 <button 
                  onClick={() => { setSelectedProfile(null); alert('Profile Logic Applied successfully.') }}
                  className="bg-brand text-black font-black py-4 rounded-2xl text-xs uppercase tracking-widest shadow-lg shadow-brand/20 hover:scale-[1.02] active:scale-95 transition-all"
                 >
                    Apply Profile
                 </button>
                 <button className="bg-white/5 border border-surface-border text-white font-bold py-4 rounded-2xl text-xs uppercase tracking-widest hover:bg-white/10 transition-all">
                    Export Logic
                 </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Status Bar */}
      <footer className="flex flex-col md:flex-row items-center justify-between px-4 py-4 md:py-3 text-[10px] text-text-dim font-mono tracking-widest bg-surface-card border border-surface-border rounded-xl gap-2 md:gap-0 mt-auto">
        <div className="flex gap-6">
          <span className="flex items-center gap-2">DB STATUS: <span className="text-brand">SYNCED</span></span>
          <span className="flex items-center gap-2"><Clock size={10} /> UPTIME: 14:22:58</span>
        </div>
        <div className="flex gap-6">
          <span className="flex items-center gap-2"><ShieldCheck size={10} className="text-brand" /> ROOT_ACCESS: GRANTED</span>
          <span className="flex items-center gap-2"><Lock size={10} /> ENCRYPTION: AES-256</span>
        </div>
      </footer>
      {/* Profile Detail View */}
      {selectedProfile && (
        <ProfileModal 
          profile={selectedProfile} 
          onClose={() => setSelectedProfile(null)} 
        />
      )}
    </div>
  );
}
