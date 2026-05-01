from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


DEFAULT_EXPECTED = (
    Path(__file__).resolve().parents[1]
    / "dataset_examples"
    / "pezzo_001_staffa_test"
    / "expected_output.json"
)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Debug CAD extraction against STAFFA TEST 1-1 ground truth."
    )
    parser.add_argument("cad_output_json", type=Path)
    parser.add_argument("--expected", type=Path, default=DEFAULT_EXPECTED)
    args = parser.parse_args()

    cad = load_json(args.cad_output_json)
    expected = load_json(args.expected)
    report = build_report(cad, expected)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def build_report(cad: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    expected_dimensions = expected.get("dimensions_mm", {})
    cad_dimensions = cad.get("dimensions_mm", {})
    expected_features = expected.get("holes", {})
    cad_features = cad.get("features", {})

    return {
        "case": expected.get("part_name", "STAFFA TEST 1-1"),
        "dimensions_delta_mm": {
            "x": delta(cad_dimensions.get("x"), expected_dimensions.get("length")),
            "y": delta(cad_dimensions.get("y"), expected_dimensions.get("width")),
            "z": delta(cad_dimensions.get("z"), expected_dimensions.get("height")),
        },
        "thickness": compare_value(cad.get("thickness_mm"), expected.get("thickness_mm")),
        "weight": compare_value(
            cad.get("estimated_weight_kg"),
            expected.get("part_weight_kg"),
        ),
        "features": {
            "circular_holes": compare_count(
                feature_count(cad_features.get("circular_holes", cad.get("holes", []))),
                expected_features.get("circular", {}).get("count"),
            ),
            "elongated_holes": compare_count(
                feature_count(cad_features.get("elongated_holes", [])),
                expected_features.get("slotted", {}).get("count"),
            ),
            "polygonal_holes": compare_count(
                feature_count(cad_features.get("polygonal_holes", [])),
                expected_features.get("polygonal", {}).get("count"),
            ),
            "flanges": compare_count(
                feature_count(cad_features.get("flanges", cad.get("flanges", []))),
                expected.get("flanges", {}).get("count"),
            ),
        },
        "warnings": cad.get("warnings", []),
    }


def delta(actual: Any, expected: Any) -> dict[str, float | None]:
    actual_number = as_number(actual)
    expected_number = as_number(expected)
    if actual_number is None or expected_number is None:
        return {"actual": actual_number, "expected": expected_number, "delta": None}
    return {
        "actual": actual_number,
        "expected": expected_number,
        "delta": round(actual_number - expected_number, 4),
    }


def compare_value(actual: Any, expected: Any) -> dict[str, float | None]:
    actual_number = as_number(actual)
    expected_number = as_number(expected)
    if actual_number is None or expected_number is None:
        return {"actual": actual_number, "expected": expected_number, "error_percent": None}
    error = abs(actual_number - expected_number) / expected_number * 100 if expected_number else None
    return {
        "actual": actual_number,
        "expected": expected_number,
        "error_percent": round(error, 4) if error is not None else None,
    }


def compare_count(actual: int, expected: Any) -> dict[str, int | None]:
    expected_number = as_number(expected)
    return {
        "actual": actual,
        "expected": int(expected_number) if expected_number is not None else None,
        "delta": actual - int(expected_number) if expected_number is not None else None,
    }


def feature_count(groups: Any) -> int:
    if not isinstance(groups, list):
        return 0
    total = 0
    for group in groups:
        if isinstance(group, dict):
            total += int(group.get("count") or 1)
    return total


def as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


if __name__ == "__main__":
    raise SystemExit(main())
