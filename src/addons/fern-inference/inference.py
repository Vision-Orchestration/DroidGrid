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
    p.add_argument("--stride",      type=int, default=15)
    p.add_argument("--confidence",  type=float, default=0.6)
    p.add_argument("--smoothing_n", type=int, default=5)
    p.add_argument("--sync_offset_sec", type=float, default=0.0,
                   help="Seconds to discard from stream start before counting "
                        "inference frames. Should match recording_assistant "
                        "sync_delay_sec + pre_start_sec (default 0).")
    return p.parse_args()

LOWER_BODY_INDICES = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]

CLASSES = [
    "foot_hold", "foot_lift", "sideway_kick", "cross_front",
    "heel_tap", "flamingo_bend", "forward_step", "forward_kick"
]

def extract_lower_body(landmarks, image_w, image_h):
    row = []
    for idx in LOWER_BODY_INDICES:
        lm = landmarks[idx]
        row.extend([lm.x, lm.y, lm.z])
    return row

def normalise(frame_features, hip_idx=0):
    arr = np.array(frame_features, dtype=np.float32).reshape(10, 3)
    hip_mid = (arr[0] + arr[1]) / 2.0
    arr -= hip_mid
    scale = np.linalg.norm(arr, axis=1).max()
    if scale > 1e-6:
        arr /= scale
    return arr.flatten().tolist()

def run(args):
    import onnxruntime as ort
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    sess = ort.InferenceSession(
        args.model,
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    input_name = sess.get_inputs()[0].name
    expected_features = 30 + args.n_cameras

    base_options = mp_python.BaseOptions(model_asset_path=args.mediapipe)
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1,
    )
    detector = mp_vision.PoseLandmarker.create_from_options(options)

    cap = None
    while cap is None or not cap.isOpened():
        if cap is not None:
            cap.release()
        cap = cv2.VideoCapture(args.rtsp_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            print(json.dumps({"event": "error", "message": f"cannot open {args.rtsp_url}, retrying in 5s"}), flush=True)
            time.sleep(5)

    frame_buf = collections.deque(maxlen=args.window_size)
    vote_buf  = collections.deque(maxlen=args.smoothing_n)
    frame_idx = 0
    stride_counter = 0
    consecutive_failures = 0
    MAX_CONSECUTIVE_FAILURES = 90

    # H6: wall-clock stream time tracking
    stream_t0 = None
    last_timestamp_ms = -1

    one_hot = [0] * args.n_cameras
    if 0 <= args.camera_id < args.n_cameras:
        one_hot[args.camera_id] = 1

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    print(json.dumps({"event": "error", "message": "stream lost"}), flush=True)
                    break
                time.sleep(0.010)
                continue
            consecutive_failures = 0

            # ── Sync offset: discard by elapsed wall time, not frame count ──
            if args.sync_offset_sec > 0 and frame_idx == 0:
                skip_t0 = time.monotonic()
                skipped = 0
                while time.monotonic() - skip_t0 < args.sync_offset_sec:
                    r2, _ = cap.read()
                    if r2:
                        skipped += 1
                    else:
                        time.sleep(0.010)
                frame_idx = 0
                print(json.dumps({"event": "sync_skip_done", "frames_skipped": skipped,
                                  "elapsed_sec": round(time.monotonic() - skip_t0, 3)}), flush=True)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            # H6: Use stream POS_MSEC when available, fall back to wall clock
            pos_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
            if pos_ms and pos_ms > 0:
                timestamp_ms = int(pos_ms)
            else:
                if stream_t0 is None:
                    stream_t0 = time.monotonic()
                timestamp_ms = int((time.monotonic() - stream_t0) * 1000)

            if timestamp_ms <= last_timestamp_ms:
                timestamp_ms = last_timestamp_ms + 1
            last_timestamp_ms = timestamp_ms

            result = detector.detect_for_video(mp_img, timestamp_ms)
            frame_idx += 1

            if not result.pose_landmarks:
                continue

            raw = extract_lower_body(result.pose_landmarks[0], frame.shape[1], frame.shape[0])
            normalised = normalise(raw)
            flagged = normalised + one_hot
            frame_buf.append(flagged)

            if len(frame_buf) < args.window_size:
                continue

            stride_counter += 1
            if stride_counter % args.stride != 0:
                continue

            window = np.array(list(frame_buf), dtype=np.float32)[None]
            logits = sess.run(None, {input_name: window})[0][0]
            probs  = np.exp(logits) / np.exp(logits).sum()
            pred   = int(probs.argmax())
            conf   = float(probs[pred])

            vote_buf.append(pred)
            smoothed = collections.Counter(vote_buf).most_common(1)[0][0]

            if conf >= args.confidence:
                event = {
                    "gesture":               CLASSES[smoothed],
                    "confidence":            conf,
                    "raw_pred":              CLASSES[pred],
                    "probs":                 probs.tolist(),
                    "timestamp":             time.time(),
                    "stream_frame":          frame_idx,
                    "inference_frame_start": frame_idx - args.window_size,
                }
                print(json.dumps(event), flush=True)
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(json.dumps({"event": "error", "message": str(e)}), flush=True)
    finally:
        cap.release()
        detector.close()

if __name__ == "__main__":
    run(parse_args())
