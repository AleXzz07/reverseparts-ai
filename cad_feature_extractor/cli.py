"""CLI for extracting technical geometric features from CAD/3D files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .extractor import extract_features


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cad_feature_extractor",
        description="Extract technical geometric features from CAD/3D files.",
    )
    parser.add_argument("input_file", help="Path to the STL, STEP, STP, IGES, or IGS file.")
    parser.add_argument(
        "-o",
        "--output",
        help="Optional JSON output path. If omitted, JSON is printed to stdout.",
    )
    parser.add_argument(
        "--density-g-cm3",
        type=float,
        default=1.0,
        help="Material density used for estimated_weight_kg. Default: 1.0 g/cm3.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON with indentation.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    result = extract_features(
        args.input_file,
        material_density_g_cm3=args.density_g_cm3,
    )
    json_output = json.dumps(
        result,
        indent=2 if args.pretty else None,
        ensure_ascii=False,
        sort_keys=False,
    )

    if args.output:
        Path(args.output).write_text(json_output + "\n", encoding="utf-8")
    else:
        print(json_output)

    return 0
