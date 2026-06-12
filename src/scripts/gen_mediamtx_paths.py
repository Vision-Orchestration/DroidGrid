#!/usr/bin/env python3
"""Regenerate the `paths:` section of mediamtx.yml from config/cameras.json.

Usage: python scripts/gen_mediamtx_paths.py [--check]
  --check  Exit 1 if mediamtx.yml is out of date (for CI), without writing.
"""
import json, re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CAMERAS = os.path.join(ROOT, "config", "cameras.json")
MEDIAMTX = os.path.join(ROOT, "mediamtx.yml")

BEGIN = "# --- BEGIN GENERATED PATHS ---"
END = "# --- END GENERATED PATHS ---"

def build_paths_block(cameras):
    lines = [BEGIN, "paths:"]
    for cam in cameras:
        lines += [
            f"  {cam['id']}:",
            f"    source: http://{cam['ip']}:{cam['port']}/mjpegfeed?1280x720",
            f"    sourceOnDemand: no",
            f"    record: yes",
            f"    recordPath: ./recordings/%path/%Y-%m-%d_%H-%M-%S-%f",
            f"    recordFormat: mp4",
            f"    recordPartDuration: 5m",
            f"    recordDeleteAfter: 0",
        ]
    lines.append(END)
    return "\n".join(lines)

def main():
    with open(CAMERAS) as f:
        cameras = json.load(f)["cameras"]
    block = build_paths_block(cameras)

    with open(MEDIAMTX) as f:
        content = f.read()

    pattern = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.DOTALL)
    if pattern.search(content):
        new_content = pattern.sub(block, content)
    else:
        new_content = re.sub(
            r"^paths:.*?(?=^\S|\Z)",
            block + "\n",
            content,
            flags=re.DOTALL | re.MULTILINE,
        )

    if "--check" in sys.argv:
        if new_content != content:
            print("mediamtx.yml is out of date — run scripts/gen_mediamtx_paths.py")
            sys.exit(1)
        print("mediamtx.yml is up to date")
        return

    if new_content != content:
        with open(MEDIAMTX, "w") as f:
            f.write(new_content)
        print(f"Updated {MEDIAMTX} with {len(cameras)} camera paths")
    else:
        print("No changes needed")

if __name__ == "__main__":
    main()
