#!/usr/bin/env python3
"""
fern_export.py — FERN Insider Mode: post-recording export pipeline
==================================================================
After a DROIDGRIDD recording session, copies label JSONs and
extracts MediaPipe skeletons into FERN's data directory structure.

Called automatically by recording_assistant.py with ‑‑auto‑export,
or standalone:
    python scripts/fern_export.py --subject p12 --label-dir data/new_recordings

Expected output:
  C:/fern/FERN_V2/data/labels/<subject>/<camera>_<timestamp>.json
  C:/fern/FERN_V2/data/skeletons/<subject>/<camera>_<timestamp>.csv
"""

import argparse, json, os, shutil, subprocess, sys, time
from pathlib import Path


def find_fern_json(subject: str, label_dir: str, camera_name: str) -> Path | None:
    """Find the newest label JSON for (subject, camera) in label_dir."""
    label_dir = Path(label_dir)
    pattern   = f"{subject}_{camera_name}_*.json"
    matches   = sorted(label_dir.glob(pattern))
    if matches:
        return matches[-1]
    # Also try without subject prefix
    pattern2 = f"*{camera_name}*{subject}*.json"
    matches2 = sorted(label_dir.glob(pattern2))
    if matches2:
        return matches2[-1]
    return None


def extract_single_video(
    video_path: str,
    output_csv: str,
    fern_src_dir: str,
    python_exe: str,
) -> dict:
    """
    Run FERN's extract_skeleton for ONE video file.
    We call extract_skeleton as a subprocess because it depends on
    mediapipe (which may have conflicting deps with DROIDGRIDD).
    """
    video_path = Path(video_path)
    if not video_path.exists():
        return {"ok": False, "error": f"Video not found: {video_path}"}

    output_csv = Path(output_csv)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    # Create a temp dir with just this one video (symlinked or copied)
    # so extract_skeleton.py's --video_dir recursion finds only it.
    temp_dir = output_csv.parent / f".tmp_{video_path.stem}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_video = temp_dir / video_path.name
    if not temp_video.exists():
        try:
            os.link(str(video_path), str(temp_video))
        except OSError:
            shutil.copy2(str(video_path), str(temp_video))

    try:
        result = subprocess.run(
            [
                python_exe, str(Path(fern_src_dir) / "extract_skeleton.py"),
                "--video_dir",  str(temp_dir),
                "--output_dir", str(output_csv.parent),
            ],
            capture_output=True, text=True, timeout=3600,
            cwd=fern_src_dir,
        )
        if result.returncode != 0:
            return {"ok": False, "error": result.stderr.strip(), "stdout": result.stdout.strip()}

        # Move the CSV to the expected path
        expected_csv = output_csv.parent / temp_dir.name / f"{video_path.stem}.csv"
        if expected_csv.exists():
            if output_csv.exists():
                output_csv.unlink()
            shutil.move(str(expected_csv), str(output_csv))

        # Read detection rate from stdout
        detection_rate = 0.0
        for line in result.stdout.splitlines():
            if "detection rate" in line:
                try:
                    detection_rate = float(line.split(":")[-1].strip().rstrip("%")) / 100.0
                except ValueError:
                    pass

        # Remove temp dir
        shutil.rmtree(str(temp_dir), ignore_errors=True)

        csv_exists = output_csv.exists() and output_csv.stat().st_size > 0
        return {
            "ok":      csv_exists,
            "path":    str(output_csv),
            "frames":  int(result.stdout.split("frames")[0].rsplit()[-1]) if "frames" in result.stdout else 0,
            "detection_rate": detection_rate,
        }

    except subprocess.TimeoutExpired:
        shutil.rmtree(str(temp_dir), ignore_errors=True)
        return {"ok": False, "error": "Timeout — video extraction exceeded 3600s"}
    except Exception as e:
        shutil.rmtree(str(temp_dir), ignore_errors=True)
        return {"ok": False, "error": str(e)}


def export_to_fern(
    subject:      str,
    label_dir:    str,
    fern_root:    str,
    fern_venv:    str,
    video_files:  dict,
    fps_map:      dict,
    extract_skeletons: bool = True,
    camera_id_map: dict | None = None,
    verbose:      bool = True,
) -> dict:
    """
    Main export function.

    Parameters
    ----------
    subject : str
        Subject ID (e.g. "p12").
    label_dir : str
        DROIDGRIDD's output directory (data/new_recordings).
    fern_root : str
        FERN's project root (C:/fern/FERN_V2).
    fern_venv : str
        Path to FERN's Python interpreter (for mediapipe).
    video_files : dict
        {camera_name: video_file_path} from MediaMTX or fallback.
    fps_map : dict
        {camera_name: actual_fps} from DroidGrid API.
    extract_skeletons : bool
        Whether to run MediaPipe extraction on each video.
    camera_id_map : dict | None
        {camera_name: camera_id} mapping. If None, uses ordinal from video_files keys.
    verbose : bool
        Print progress.

    Returns
    -------
    dict with keys: ok, cameras (list of per-camera results), summary
    """
    fern_root    = Path(fern_root)
    label_dir    = Path(label_dir)
    fern_src     = fern_root / "src"
    fern_labels  = fern_root / "data" / "labels" / subject
    fern_skeletons = fern_root / "data" / "skeletons" / subject

    fern_labels.mkdir(parents=True, exist_ok=True)
    fern_skeletons.mkdir(parents=True, exist_ok=True)

    python_exe = fern_venv if fern_venv and Path(fern_venv).exists() else "python"

    if camera_id_map is None:
        camera_id_map = {name: i for i, name in enumerate(video_files.keys())}

    results = []

    for cam_name in sorted(video_files.keys()):
        cam_result = {"camera": cam_name, "ok": False}

        # 1. Find and copy label JSON
        label_json = find_fern_json(subject, str(label_dir), cam_name)
        if label_json:
            dest_json = fern_labels / label_json.name
            shutil.copy2(str(label_json), str(dest_json))
            # Inject camera_id from map if not already set
            with open(str(dest_json)) as f:
                data = json.load(f)
            cam_id = camera_id_map.get(cam_name, 0)
            if data.get("camera_id") != cam_id:
                data["camera_id"] = cam_id
                with open(str(dest_json), "w") as f:
                    json.dump(data, f, indent=2)
            cam_result["label"] = str(dest_json)
            if verbose:
                print(f"  [{cam_name}] label → {dest_json}")
        else:
            cam_result["label_error"] = f"No label JSON for {subject}_{cam_name}"

        # 2. Extract skeletons
        video_path = video_files.get(cam_name, "")
        if extract_skeletons and video_path:
            output_csv = fern_skeletons / f"{Path(label_json).stem if label_json else cam_name}.csv"
            if verbose:
                print(f"  [{cam_name}] extracting skeleton → {output_csv} ...", end=" ", flush=True)
            extract_result = extract_single_video(
                video_path, str(output_csv), str(fern_src), python_exe
            )
            cam_result["skeleton"] = extract_result
            if verbose:
                if extract_result.get("ok"):
                    print(f"{extract_result.get('frames', 0)} frames, "
                          f"detection: {extract_result.get('detection_rate', 0)*100:.1f}%")
                else:
                    print(f"FAILED: {extract_result.get('error', 'unknown')}")
        elif extract_skeletons:
            cam_result["skeleton_error"] = "No video path available"

        # 3. Copy raw video to FERN's data/raw (optional)
        if video_path and Path(video_path).exists():
            fern_raw = fern_root / "data" / "raw" / subject
            fern_raw.mkdir(parents=True, exist_ok=True)
            dest_video = fern_raw / Path(video_path).name
            if not dest_video.exists():
                try:
                    os.link(str(video_path), str(dest_video))
                except OSError:
                    shutil.copy2(str(video_path), str(dest_video))
            cam_result["video"] = str(dest_video)

        cam_result["ok"] = cam_result.get("label") is not None
        results.append(cam_result)

    # Summary
    n_label  = sum(1 for r in results if r.get("label"))
    n_skel   = sum(1 for r in results if r.get("skeleton", {}).get("ok"))
    n_video  = sum(1 for r in results if r.get("video"))

    summary = {
        "total_cameras": len(results),
        "labels_exported":  n_label,
        "skeletons_extracted": n_skel,
        "videos_copied":    n_video,
    }
    if verbose:
        print()
        print(f"  FERN export summary for subject '{subject}':")
        print(f"    labels:    {n_label}/{len(results)}")
        print(f"    skeletons: {n_skel}/{len(results)}")
        print(f"    videos:    {n_video}/{len(results)}")
        print()

    return {"ok": n_label > 0, "cameras": results, "summary": summary}


def main():
    p = argparse.ArgumentParser(
        description="FERN Insider Mode — export DROIDGRIDD recording to FERN"
    )
    p.add_argument("--subject",     required=True, help="Subject ID (e.g. p12)")
    p.add_argument("--label-dir",   default="data/new_recordings",
                   help="DROIDGRIDD label output directory")
    p.add_argument("--fern-root",   default="C:/fern/FERN_V2",
                   help="FERN project root")
    p.add_argument("--fern-venv",   default="C:/fern/FERN_V2/venv/Scripts/python.exe",
                   help="FERN Python interpreter (for mediapipe)")
    p.add_argument("--video-files", default="",
                   help="JSON string: {camera_name: video_path}")
    p.add_argument("--fps-map",     default="",
                   help="JSON string: {camera_name: fps}")
    p.add_argument("--no-skeleton", action="store_true",
                   help="Skip MediaPipe skeleton extraction")
    args = p.parse_args()

    video_files = json.loads(args.video_files) if args.video_files else {}
    fps_map     = json.loads(args.fps_map) if args.fps_map else {}

    result = export_to_fern(
        subject=args.subject,
        label_dir=args.label_dir,
        fern_root=args.fern_root,
        fern_venv=args.fern_venv,
        video_files=video_files,
        fps_map=fps_map,
        extract_skeletons=not args.no_skeleton,
        verbose=True,
    )

    print(json.dumps(result, indent=2))
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
