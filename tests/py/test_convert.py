import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

CONVERT = (
    Path(__file__).parent.parent
    / "addons"
    / "gridflow-bridge"
    / "scripts"
    / "convert.py"
)


def run_convert(args, cwd):
    return subprocess.run(
        [sys.executable, str(CONVERT), *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )


class TestDeterministicCSV:
    def test_csv_field_order_is_deterministic(self, tmp_path):
        rows = [
            {"gesture": "heel_tap", "confidence": 0.9, "frame": 100},
            {
                "gesture": "foot_lift",
                "extra_field": True,
                "confidence": 0.8,
                "frame": 130,
            },
        ]
        src = tmp_path / "events.json"
        src.write_text(json.dumps(rows))

        headers_set = set()
        for i in range(5):
            out = tmp_path / f"out{i}.csv"
            result = run_convert(
                ["--input", str(src), "--format", "csv", "--output", str(out)],
                tmp_path,
            )
            assert result.returncode == 0, result.stderr
            with open(out) as f:
                headers_set.add(tuple(next(csv.reader(f))))
        assert len(headers_set) == 1, f"Non-deterministic headers: {headers_set}"

    def test_csv_headers_are_sorted(self, tmp_path):
        rows = [{"b": 1, "a": 2}, {"c": 3, "a": 4}]
        src = tmp_path / "events.json"
        src.write_text(json.dumps(rows))
        out = tmp_path / "out.csv"
        result = run_convert(
            ["--input", str(src), "--format", "csv", "--output", str(out)],
            tmp_path,
        )
        assert result.returncode == 0, result.stderr
        with open(out) as f:
            header = next(csv.reader(f))
        assert header == ["a", "b", "c"]

    def test_json_roundtrip_lossless(self, tmp_path):
        rows = [
            {"gesture": "heel_tap", "nested": {"x": 1}, "confidence": 0.93}
        ]
        src = tmp_path / "in.json"
        src.write_text(json.dumps(rows))
        out = tmp_path / "out.json"
        result = run_convert(
            ["--input", str(src), "--format", "json", "--output", str(out)],
            tmp_path,
        )
        assert result.returncode == 0, result.stderr
        assert json.loads(out.read_text()) == rows
