/**
 * GridFlow Bridge Addon — DroidGrid Plugin
 * Bridges DroidGrid camera data to external GridFlow pipelines.
 * Periodically syncs camera state, recordings metadata, and gesture
 * events to a configurable GridFlow endpoint.
 *
 * API routes (auto-prefixed /api/addons/gridflow-bridge/):
 *   GET  /status     → { connected: bool, lastSync: string, pending: number }
 *   POST /sync       → trigger an immediate sync
 *   GET  /config     → current configuration
 *   PUT  /config     → update configuration
 *   POST /export     → export current data as configured format
 */

interface AddonContext {
  getCameras(): any[];
  registerRoute(method: "GET"|"POST"|"PUT"|"DELETE", path: string, handler: Function): void;
  log(msg: string, level?: "info"|"warn"|"error"|"success"): void;
  getConfig(): Record<string, unknown>;
  setConfig(patch: Record<string, unknown>): void;
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
}

interface DroidGridAddon {
  id: string;
  init(ctx: AddonContext): Promise<void>;
  destroy(): Promise<void>;
}

export default class GridFlowBridgeAddon implements DroidGridAddon {
  id = "gridflow-bridge";
  private ctx!: AddonContext;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSync: string | null = null;
  private exportFormat: string = "json";

  async init(ctx: AddonContext) {
    this.ctx = ctx;
    ctx.log("GridFlow Bridge addon initialised", "success");

    const cfg = ctx.getConfig();
    this.exportFormat = String(cfg.export_format ?? "json");

    ctx.registerRoute("GET", "/status", (_req: any, res: any) => {
      res.json({
        connected: this.syncTimer !== null,
        lastSync: this.lastSync,
        endpoint: ctx.getConfig().endpoint ?? "not configured",
      });
    });

    ctx.registerRoute("POST", "/sync", async (_req: any, res: any) => {
      await this.doSync();
      res.json({ ok: true, lastSync: this.lastSync });
    });

    ctx.registerRoute("GET", "/config", (_req: any, res: any) => {
      res.json(ctx.getConfig());
    });

    ctx.registerRoute("PUT", "/config", (req: any, res: any) => {
      ctx.setConfig(req.body);
      if (req.body.export_format) this.exportFormat = req.body.export_format;
      this.restartSync();
      ctx.log("GridFlow config updated", "success");
      res.json({ ok: true });
    });

    ctx.registerRoute("POST", "/export", async (_req: any, res: any) => {
      try {
        const data = this.buildExportPayload();
        res.json({ ok: true, format: this.exportFormat, data });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    ctx.on("fern:gesture", (event: any) => {
      this.forwardEvent("gesture", event);
    });

    this.startSync();
    ctx.log("GridFlow Bridge routes registered", "info");
  }

  private startSync() {
    const cfg = this.ctx.getConfig();
    const interval = (cfg.batch_interval ?? 5) * 1000;
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => this.doSync(), interval);
    this.ctx.log(`Auto-sync every ${interval / 1000}s`, "info");
  }

  private restartSync() {
    this.startSync();
  }

  private async doSync() {
    try {
      const cfg = this.ctx.getConfig();
      if (!cfg.auto_sync) return;

      const cameras = this.ctx.getCameras();
      const payload = {
        source: "droidgrid",
        timestamp: new Date().toISOString(),
        cameras: cameras.map((c: any) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          ip: c.ip,
          port: c.port,
          fps: c.fps,
          res: c.res,
        })),
        stats: {
          total: cameras.length,
          online: cameras.filter((c: any) => c.status === "online" || c.status === "recording").length,
          recording: cameras.some((c: any) => c.status === "recording"),
        },
      };

      if (cfg.endpoint && cfg.endpoint !== "http://localhost:8100") {
        const resp = await fetch(`${cfg.endpoint}/api/droidgrid/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cfg.api_key ? { "Authorization": `Bearer ${cfg.api_key}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          this.ctx.log(`GridFlow sync failed: ${resp.status}`, "warn");
        }
      }

      this.lastSync = new Date().toISOString();
    } catch (e: any) {
      this.ctx.log(`GridFlow sync error: ${e.message}`, "warn");
    }
  }

  private forwardEvent(type: string, data: any) {
    const cfg = this.ctx.getConfig();
    if (!cfg.endpoint || cfg.endpoint === "http://localhost:8100") return;
    fetch(`${cfg.endpoint}/api/droidgrid/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.api_key ? { "Authorization": `Bearer ${cfg.api_key}` } : {}),
      },
      body: JSON.stringify({ type, data, timestamp: new Date().toISOString() }),
    }).catch(() => {});
  }

  private buildExportPayload(): any {
    const cameras = this.ctx.getCameras();
    return {
      exportedAt: new Date().toISOString(),
      generator: "droidgrid-gridflow-bridge-v1",
      cameras: cameras.map((c: any) => ({
        name: c.name,
        ip: c.ip,
        port: c.port,
        status: c.status,
        res: c.res,
        fps: c.fps,
      })),
      session: null,
    };
  }

  async destroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.ctx.log("GridFlow Bridge destroyed", "info");
  }
}
