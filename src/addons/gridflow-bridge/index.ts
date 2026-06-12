/**
 * GridFlow Bridge Addon — DroidGrid Plugin
 * Bridges DroidGrid camera data to external GridFlow pipelines.
 * Periodically syncs camera state, recordings metadata, and gesture
 * events to a configurable GridFlow endpoint.
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

import { createForwarder, type Forwarder, type SendEventsFn } from "./forwarder.js";

const RETRY_OPTIONS = { retries: 3, baseDelayMs: 500 };
const MAX_QUEUE = 100;

export default class GridFlowBridgeAddon implements DroidGridAddon {
  id = "gridflow-bridge";
  private ctx!: AddonContext;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSync: string | null = null;
  private exportFormat: string = "json";
  private forwarder!: Forwarder;

  async init(ctx: AddonContext) {
    this.ctx = ctx;
    ctx.log("GridFlow Bridge addon initialised", "success");

    const cfg = ctx.getConfig();
    this.exportFormat = String(cfg.export_format ?? "json");

    // Create forwarder with fetch as the sendEvents function
    this.forwarder = createForwarder(this._makeSendEvents(), {
      maxQueue: MAX_QUEUE,
      ...RETRY_OPTIONS,
    });

    ctx.registerRoute("GET", "/status", (_req: any, res: any) => {
      res.json({
        connected: this.syncTimer !== null,
        lastSync: this.lastSync,
        endpoint: this.isConfigured() ? ctx.getConfig().endpoint : "not configured",
        queueLength: this.forwarder.queue.length,
        droppedEvents: this.forwarder.droppedEvents,
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
      this.enqueueEvent("gesture", event);
    });

    this.startSync();
    ctx.log("GridFlow Bridge routes registered", "info");
  }

  private isConfigured(): boolean {
    const ep = this.ctx.getConfig().endpoint;
    return typeof ep === "string" && ep.length > 0 && this.ctx.getConfig().enabled !== false;
  }

  private _makeSendEvents(): SendEventsFn {
    return async (batch: unknown[]) => {
      const endpoint = this.ctx.getConfig().endpoint as string;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      try {
        const res = await fetch(`${endpoint}/api/droidgrid/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.ctx.getConfig().api_key ? { Authorization: `Bearer ${this.ctx.getConfig().api_key}` } : {}),
          },
          body: JSON.stringify({ events: batch }),
          signal: ac.signal,
        });
        clearTimeout(timer);
        if (res.ok) return true;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          this.ctx.log(`GridFlow event rejected (${res.status}), dropping batch`, "warn");
          return true;
        }
        return false;
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    };
  }

  private enqueueEvent(type: string, data: unknown) {
    if (!this.isConfigured()) return;
    this.forwarder.enqueue({ type, data, timestamp: new Date().toISOString() });
    this.forwarder.flush();
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
          id: c.id, name: c.name, status: c.status,
          ip: c.ip, port: c.port, fps: c.fps, res: c.res,
        })),
        stats: {
          total: cameras.length,
          online: cameras.filter((c: any) => c.status === "online" || c.status === "recording").length,
          recording: cameras.some((c: any) => c.status === "recording"),
        },
      };

      if (this.isConfigured()) {
        const endpoint = cfg.endpoint as string;
        await this.forwardWithRetry(`${endpoint}/api/droidgrid/sync`, payload);
      }

      this.lastSync = new Date().toISOString();
    } catch (e: any) {
      this.ctx.log(`GridFlow sync error: ${e.message}`, "warn");
    }
  }

  private async forwardWithRetry(url: string, payload: unknown): Promise<void> {
    const { retries, baseDelayMs } = RETRY_OPTIONS;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 5000);
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.ctx.getConfig().api_key ? { Authorization: `Bearer ${this.ctx.getConfig().api_key}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        clearTimeout(timer);
        if (resp.ok) return;
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          this.ctx.log(`GridFlow endpoint rejected sync (${resp.status})`, "warn");
          return;
        }
        throw new Error(`HTTP ${resp.status}`);
      } catch (err) {
        if (attempt === retries) {
          this.ctx.log(`GridFlow sync failed after ${retries + 1} attempts: ${(err as Error).message}`, "error");
          return;
        }
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }

  private buildExportPayload(): any {
    const cameras = this.ctx.getCameras();
    return {
      exportedAt: new Date().toISOString(),
      generator: "droidgrid-gridflow-bridge-v2",
      cameras: cameras.map((c: any) => ({
        name: c.name, ip: c.ip, port: c.port,
        status: c.status, res: c.res, fps: c.fps,
      })),
      session: null,
    };
  }

  async destroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.ctx.log("GridFlow Bridge destroyed", "info");
  }
}
