/**
 * server_recording_stop_patch.ts
 * ================================
 * Drop-in replacement for the recording/stop and recording/status
 * handlers in DroidGrid Pro/server.ts.
 *
 * Changes vs original:
 *  1. After stopping, queries MediaMTX /v3/recordings/list and returns
 *     actual file paths keyed by camera name.
 *  2. Exposes /api/recording/status with elapsed seconds for polling.
 *  3. Adds /api/recording/files endpoint for late file path retrieval.
 *
 * HOW TO APPLY: see AGENTS.md §PATCH-SERVER
 */

// ── Constants (already exist in server.ts — do NOT duplicate) ────────────────
// const MEDIAMTX_API = "http://localhost:9997/v3";   // already declared


// ── Helper: query MediaMTX for recording file paths ──────────────────────────
async function getMediaMTXRecordingPaths(
  cameraNames: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const resp = await fetch(`${MEDIAMTX_API}/recordings/list`);
    if (!resp.ok) return result;
    const data = await resp.json();
    const items: Array<{ name: string; segments?: Array<{ fpath?: string }> }> =
      data.items ?? [];
    for (const item of items) {
      const segs = item.segments ?? [];
      if (!segs.length) continue;
      // Use the last (most-recently-closed) segment
      const latestPath = segs[segs.length - 1].fpath ?? "";
      for (const cam of cameraNames) {
        if (item.name.toLowerCase().includes(cam.toLowerCase())) {
          result[cam] = latestPath;
        }
      }
    }
  } catch (err) {
    addLog("REC", `MediaMTX file-path query failed: ${err}`, "warn");
  }
  return result;
}

// ── Helper: stop individual MediaMTX recording path ──────────────────────────
async function stopMediaMTXPath(pathName: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${MEDIAMTX_API}/config/paths/${encodeURIComponent(pathName)}/record/stop`,
      { method: "POST" }
    );
    return r.ok;
  } catch {
    return false;
  }
}


// ════════════════════════════════════════════════════════════════════════════
//  REPLACE THESE THREE HANDLERS IN server.ts
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/recording/start ─────────────────────────────────────────────
// (patch: return session_id for polling; add subject_id to log)
app.post("/api/recording/start", (_req: Request, res: Response) => {
  if (isRecording) {
    res.json({ ok: false, msg: "Already recording" });
    return;
  }
  const online = cameras.filter((c) => c.enabled && c.status === "online");
  if (!online.length) {
    addLog("REC", "Start failed — no cameras online", "error");
    res.json({ ok: false, msg: "No cameras online" });
    return;
  }

  isRecording       = true;
  recordingStartTime = Date.now();
  const sessionId   = `sess-${recordingStartTime}`;

  online.forEach((c) => {
    c.status = "recording";
  });
  writeJson(CAMERAS_FILE, cameras);

  const subjectId = (_req.body as Record<string, string>).subject_id ?? session.person;
  addLog(
    "REC",
    `Started: ${session.label}/${session.person}/${session.repeat} — ` +
      `${online.length} cam(s)  subject:${subjectId}`,
    "success"
  );

  res.json({
    ok:         true,
    session_id: sessionId,       // ← new: lets recording_assistant.py track this
    cameras:    online.length,
    session:    { ...session },
  });
});


// ── GET /api/recording/status ─────────────────────────────────────────────
// (patch: add elapsed seconds for polling-confirmation)
app.get("/api/recording/status", (_req: Request, res: Response) => {
  const elapsed =
    isRecording && recordingStartTime
      ? Math.round((Date.now() - recordingStartTime) / 1000)
      : 0;
  res.json({
    recording: isRecording,          // ← recording_assistant polls this
    elapsed,
    session,
    cameras: cameras
      .filter((c) => c.status === "recording")
      .map((c) => ({ id: c.id, name: c.name })),
  });
});


// ── POST /api/recording/stop ─────────────────────────────────────────────
// (patch: return actual MediaMTX file paths per camera)
app.post("/api/recording/stop", async (_req: Request, res: Response) => {
  if (!isRecording) {
    res.json({ ok: false, msg: "Not recording" });
    return;
  }

  const duration = recordingStartTime
    ? Math.round((Date.now() - recordingStartTime) / 1000)
    : 0;

  isRecording       = false;
  recordingStartTime = null;

  // Stop MediaMTX paths for every enabled camera
  const recordingCameras = cameras.filter(
    (c) => c.enabled && c.status === "recording"
  );
  await Promise.all(
    recordingCameras.map((c) =>
      stopMediaMTXPath(c.name.toLowerCase().replace(/[\s_]+/g, "-"))
    )
  );

  cameras.forEach((c) => {
    if (c.status === "recording") c.status = "online";
  });
  writeJson(CAMERAS_FILE, cameras);

  // Give MediaMTX 600 ms to flush and close the file before querying
  await new Promise((r) => setTimeout(r, 600));

  // Retrieve actual file paths from MediaMTX
  const cameraNames = recordingCameras.map((c) => c.name);
  const files       = await getMediaMTXRecordingPaths(cameraNames);

  // Auto-advance repeat counter
  try {
    const n    = parseInt(session.repeat.replace(/\D/g, ""), 10) + 1;
    session.repeat = `r${String(n).padStart(2, "0")}`;
    writeJson(SESSION_FILE, session);
  } catch {
    /* ignore */
  }

  addLog(
    "REC",
    `Stopped after ${duration}s  files:${JSON.stringify(files)}`,
    "success"
  );

  res.json({
    ok:        true,
    duration,
    newRepeat: session.repeat,
    files,           // ← { "phone1": "/recordings/phone1/2025-…mp4", ... }
    cameras:   cameraNames,
  });
});


// ── GET /api/recording/files ──────────────────────────────────────────────
// Late file-path retrieval — call after stop if the stop response was missed.
app.get("/api/recording/files", async (_req: Request, res: Response) => {
  const cameraNames = cameras.filter((c) => c.enabled).map((c) => c.name);
  const files       = await getMediaMTXRecordingPaths(cameraNames);
  res.json({ files });
});
