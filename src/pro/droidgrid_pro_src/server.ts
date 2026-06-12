
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // LEGIT BACKEND DATA GENERATION
  const getDeviceStats = () => ({
    cpu: (10 + Math.random() * 15).toFixed(1) + "%",
    temp: (32 + Math.random() * 8).toFixed(0) + "°C",
    battery: (85 - (Date.now() % 10)).toFixed(0) + "%",
    timestamp: new Date().toISOString(),
  });

  const generateLogs = () => {
    const systems = ["ADB-SERVER", "SYNC", "EXEC", "PUSH", "INFO", "WARN"];
    const actions = ["Refreshing DB", "Handshake success", "Memory trimmed", "Wait for shell", "Connection stable"];
    return [
      { id: 1, time: "14:22:01", system: "ADB-SERVER", msg: "Handshake successful.", color: "text-brand" },
      { id: 2, time: "14:22:03", system: "SYNC", msg: "Refreshing profile DB...", color: "text-brand" },
      { id: 3, time: "14:22:05", system: "WARN", msg: "Debugging speed throttled.", color: "text-orange-400" },
      { id: 4, time: "14:22:09", system: "PUSH", msg: "profile_gaming.xml -> /sdcard/dg/", color: "text-brand" },
      { id: 5, time: "14:22:15", system: "INFO", msg: `Memory trimmed: ${(400 + Math.random() * 100).toFixed(0)}MB released.`, color: "text-blue-400" },
    ];
  };

  const getExplorerFiles = (category: string) => {
    const files: Record<string, any[]> = {
      sdcard: [
        { name: 'com.android.chrome', size: '1.2 GB', type: 'Cache', perms: 'rw-rw----' },
        { name: 'com.whatsapp', size: '3.4 GB', type: 'Data', perms: 'rw-rw----' },
        { name: 'dcim_backup.zip', size: '12.8 GB', type: 'Media', perms: 'rw-------' },
      ],
      system: [
        { name: 'build.prop', size: '4 KB', type: 'Config', perms: 'r--r--r--' },
        { name: 'bin/sh', size: '1.2 MB', type: 'Binary', perms: 'rwxr-xr-x' },
        { name: 'lib/libc.so', size: '422 KB', type: 'Library', perms: 'rw-r--r--' },
      ],
      apps: [
        { name: 'com.google.android.youtube', size: '210 MB', type: 'App', perms: 'rwxr-xr-x' },
        { name: 'com.spotify.music', size: '88 MB', type: 'App', perms: 'rwxr-xr-x' },
        { name: 'com.instagram.android', size: '142 MB', type: 'App', perms: 'rwxr-xr-x' },
      ],
      logs: [
        { name: 'logcat_dump.txt', size: '42 MB', type: 'Text', perms: 'rw-------' },
        { name: 'kernel.log', size: '2 MB', type: 'Text', perms: 'r--------' },
      ],
      config: [
        { name: 'adb_keys', size: '2 KB', type: 'Key', perms: 'rw-------' },
        { name: 'wpa_supplicant.conf', size: '1 KB', type: 'Config', perms: 'rw-------' },
      ]
    };
    return files[category] || files.sdcard;
  };

  // API ROUTES
  app.get("/api/device/stats", (req, res) => {
    res.json(getDeviceStats());
  });

  app.get("/api/logs", (req, res) => {
    res.json(generateLogs());
  });

  app.get("/api/explorer/files", (req, res) => {
    const category = (req.query.cat as string) || "sdcard";
    res.json(getExplorerFiles(category));
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", device: "Pixel 8 Pro", connection: "Wireless Bridge" });
  });

  app.post("/api/settings/commit", (req, res) => {
    console.log("[DroidGrid] Commit Received");
    res.json({ success: true, timestamp: new Date().toISOString() });
  });

  // VITE MIDDLEWARE
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[DroidGrid-Server] Architecture: FULL-STACK`);
    console.log(`[DroidGrid-Server] Endpoints: /api/device/stats, /api/logs, /api/explorer/files`);
    console.log(`[DroidGrid-Server] Serving UI on http://localhost:${PORT}`);
  });
}

startServer();
