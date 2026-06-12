/**
 * FERN Inference Addon — DroidGrid Plugin
 * Spawns a Python subprocess running inference.py, parses JSON gesture
 * events from stdout, and emits them to the DroidGrid event bus.
 *
 * API routes (auto-prefixed /api/addons/fern-inference/):
 *   GET  /status   → { running: bool, pid: number|null }
 *   POST /start    → start the inference subprocess
 *   POST /stop     → stop the inference subprocess
 *   GET  /config   → current configuration
 *   PUT  /config   → update configuration (restart required)
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { createInterface } from "readline";

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

export default class FernInferenceAddon implements DroidGridAddon {
  id = "fern-inference";
  private ctx!: AddonContext;
  private proc: ChildProcess | null = null;

  async init(ctx: AddonContext) {
    this.ctx = ctx;
    ctx.log("FERN inference addon initialised", "success");

    ctx.registerRoute("GET", "/status", (_req: any, res: any) => {
      res.json({ running: !!this.proc, pid: this.proc?.pid ?? null });
    });

    ctx.registerRoute("POST", "/start", (_req: any, res: any) => {
      this.startInference();
      res.json({ ok: true });
    });

    ctx.registerRoute("POST", "/stop", (_req: any, res: any) => {
      this.stopInference();
      res.json({ ok: true });
    });

    ctx.registerRoute("GET", "/config", (_req: any, res: any) => {
      res.json(ctx.getConfig());
    });

    ctx.registerRoute("PUT", "/config", (req: any, res: any) => {
      ctx.setConfig(req.body);
      ctx.log("Config updated — restart addon to apply", "warn");
      res.json({ ok: true });
    });

    ctx.log("FERN routes registered", "info");
  }

  private startInference() {
    if (this.proc) {
      this.ctx.log("Inference already running", "warn");
      return;
    }

    const cfg = this.ctx.getConfig();
    const scriptPath = path.join(process.cwd(), "addons", "fern-inference", "inference.py");

    const args = [
      scriptPath,
      "--model",        String(cfg.model_path ?? "./models/fern_v2.onnx"),
      "--mediapipe",    String(cfg.mediapipe_task ?? "./models/pose_landmarker_heavy.task"),
      "--rtsp_url",     `rtsp://localhost:8554/${cfg.target_camera ?? "phone1"}`,
      "--n_cameras",    String(cfg.n_cameras ?? 1),
      "--camera_id",    String(cfg.camera_id ?? 0),
      "--window_size",  String(cfg.window_size ?? 60),
      "--stride",       String(cfg.stride ?? 15),
      "--confidence",   String(cfg.confidence ?? 0.6),
      "--smoothing_n",  String(cfg.smoothing_n ?? 5),
      "--sync_offset_sec", String(cfg.sync_offset_sec ?? 4.0),
    ];

    this.ctx.log(`Spawning: python ${args.join(" ")}`, "info");

    this.proc = spawn("python", args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const rl = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity });
    rl.on("line", (line: string) => {
      try {
        const event = JSON.parse(line);
        if (event.gesture) {
          this.ctx.emit("fern:gesture", event);
          this.ctx.log(
            `Gesture: ${event.gesture} (${(event.confidence * 100).toFixed(0)}%)`,
            "success"
          );
        }
      } catch {
        // Non-JSON line — treat as log output
        this.ctx.log(`[inference] ${line}`, "info");
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      this.ctx.log(`[inference:err] ${data.toString().trim()}`, "warn");
    });

    this.proc.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      this.ctx.log(`Inference process exited: ${reason}`, code === 0 ? "info" : "warn");
      this.proc = null;
    });

    this.ctx.log("FERN inference started", "success");
  }

  private stopInference() {
    if (!this.proc) {
      this.ctx.log("No inference process running", "warn");
      return;
    }
    this.proc.kill("SIGTERM");
    setTimeout(() => {
      if (this.proc) {
        this.proc.kill("SIGKILL");
        this.proc = null;
      }
    }, 3000);
    this.ctx.log("Inference stopped", "info");
  }

  async destroy() {
    this.stopInference();
  }
}
