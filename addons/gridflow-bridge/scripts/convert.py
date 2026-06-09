#!/usr/bin/env python3
"""
gridflow-bridge/scripts/convert.py
Converts DroidGrid data exports between formats (JSON, CSV, Parquet).
Used by the GridFlow Bridge addon for data transformation.

Usage:
    python scripts/convert.py --input data.json --output data.csv
    python scripts/convert.py --input data.json --format parquet
"""

import argparse
import json
import csv
import io
import sys
from pathlib import Path

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False


def read_input(path: str) -> list:
    with open(path) as f:
        data = json.load(f)
    cameras = data.get("cameras", data if isinstance(data, list) else [])
    return cameras


def to_csv(data: list, output: str):
    if not data:
        print("No data to convert")
        return
    fieldnames = set()
    for row in data:
        fieldnames.update(row.keys())
    fieldnames = sorted(fieldnames)
    with open(output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
    print(f"CSV written: {output} ({len(data)} rows)")


def to_parquet(data: list, output: str):
    if not HAS_PANDAS:
        print("pandas required for parquet export: pip install pandas pyarrow")
        sys.exit(1)
    df = pd.DataFrame(data)
    df.to_parquet(output, index=False)
    print(f"Parquet written: {output} ({len(df)} rows)")


def main():
    p = argparse.ArgumentParser(description="GridFlow Data Converter")
    p.add_argument("--input", required=True, help="Input JSON file")
    p.add_argument("--output", help="Output file path (auto-derived if omitted)")
    p.add_argument("--format", choices=["csv", "parquet", "json"],
                   default="csv", help="Output format")

    args = p.parse_args()
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input not found: {args.input}")
        sys.exit(1)

    output = args.output or str(input_path.with_suffix(f".{args.format}"))
    data = read_input(args.input)

    if args.format == "csv":
        to_csv(data, output)
    elif args.format == "parquet":
        to_parquet(data, output)
    else:
        print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
