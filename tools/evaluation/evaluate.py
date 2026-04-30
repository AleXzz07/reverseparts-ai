"""Evaluate CAD extraction JSON against a REVERSEPARTS ground truth dataset."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


NUMERIC_FIELDS = [
    "thickness_mm",
    "part_weight_kg",
    "blank_weight_kg",
    "blank_perimeter_mm",
]


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


def normalize_dimensions(value: Any, axes: tuple[str, ...]) -> dict[str, float | None]:
    if not isinstance(value, dict):
        return {axis: None for axis in axes}

    aliases = {
        "x": ("x", "length", "l"),
        "y": ("y", "width", "w"),
        "z": ("z", "height", "h"),
    }
    normalized: dict[str, float | None] = {}
    for axis in axes:
        normalized[axis] = None
        for key in aliases[axis]:
            if key in value:
                normalized[axis] = as_number(value[key])
                break
    return normalized


def as_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, str):
        try:
            return float(value.replace(",", "."))
        except ValueError:
            return None
    return None


def normalize_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.strip().casefold().split())


def normalize_process_steps(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted({normalize_string(item) for item in value if normalize_string(item)})


def normalize_ground_truth(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "part_name": data.get("part_name", ""),
        "material": data.get("material", ""),
        "thickness_mm": as_number(data.get("thickness_mm")),
        "dimensions_mm": normalize_dimensions(data.get("dimensions_mm"), ("x", "y", "z")),
        "part_weight_kg": as_number(data.get("part_weight_kg")),
        "blank_size_mm": normalize_dimensions(data.get("blank_size_mm"), ("x", "y")),
        "blank_weight_kg": as_number(data.get("blank_weight_kg")),
        "blank_perimeter_mm": as_number(data.get("blank_perimeter_mm")),
        "features": {
            "circular_holes": normalize_ground_truth_groups(
                data.get("holes", {}).get("circular") if isinstance(data.get("holes"), dict) else None,
                "diameter_mm",
            ),
            "elongated_holes": normalize_ground_truth_groups(
                data.get("holes", {}).get("slotted") if isinstance(data.get("holes"), dict) else None,
                "length_mm",
            ),
            "polygonal_holes": normalize_ground_truth_groups(
                data.get("holes", {}).get("polygonal") if isinstance(data.get("holes"), dict) else None,
                "size_mm",
            ),
            "flanges": normalize_ground_truth_groups(data.get("flanges"), "length_mm"),
        },
        "process_steps": normalize_process_steps(data.get("process_steps")),
    }


def normalize_ground_truth_groups(value: Any, metric_key: str) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return []
    groups = value.get("groups")
    if isinstance(groups, list):
        return normalize_groups(groups, metric_key)

    count = as_number(value.get("count"))
    if count is None:
        return []
    return [{"count": int(count), metric_key: None}]


def normalize_extracted(data: dict[str, Any]) -> dict[str, Any]:
    features = data.get("features") if isinstance(data.get("features"), dict) else {}
    cad_holes = data.get("holes") if isinstance(data.get("holes"), list) else []
    cad_flanges = data.get("flanges") if isinstance(data.get("flanges"), list) else []

    circular_holes = normalize_groups(features.get("circular_holes"), "diameter_mm")
    if not circular_holes and cad_holes:
        holes_count = as_number(data.get("holes_count"))
        if holes_count is not None:
            circular_holes = [{"count": int(holes_count), "diameter_mm": None}]

    flanges = normalize_groups(features.get("flanges"), "length_mm")
    if not flanges and cad_flanges:
        flanges = normalize_groups(cad_flanges, "length_mm")
    if not flanges and as_number(data.get("bends_count")) is not None:
        flanges = [{"count": int(as_number(data.get("bends_count")) or 0), "length_mm": None}]

    return {
        "part_name": data.get("part_name", ""),
        "material": data.get("material", ""),
        "thickness_mm": as_number(data.get("thickness_mm")),
        "dimensions_mm": normalize_dimensions(data.get("dimensions_mm"), ("x", "y", "z")),
        "part_weight_kg": first_number(data, ["part_weight_kg", "estimated_weight_kg"]),
        "blank_size_mm": normalize_dimensions(data.get("blank_size_mm"), ("x", "y")),
        "blank_weight_kg": as_number(data.get("blank_weight_kg")),
        "blank_perimeter_mm": as_number(data.get("blank_perimeter_mm")),
        "features": {
            "circular_holes": circular_holes,
            "elongated_holes": normalize_groups(features.get("elongated_holes"), "length_mm"),
            "polygonal_holes": normalize_groups(features.get("polygonal_holes"), "size_mm"),
            "flanges": flanges,
        },
        "process_steps": normalize_process_steps(data.get("process_steps")),
    }


def first_number(data: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = as_number(data.get(key))
        if value is not None:
            return value
    return None


def normalize_groups(value: Any, metric_key: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    groups: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        count = as_number(item.get("count"))
        if count is None and "id" in item:
            count = 1
        metric = as_number(item.get(metric_key))
        groups.append({"count": int(count or 0), metric_key: metric})
    return groups


def percentage_error(expected: float | None, actual: float | None) -> float | None:
    if expected is None or actual is None or expected == 0:
        return None
    return round(abs(actual - expected) / abs(expected) * 100.0, 4)


def compare_scalar(
    field: str,
    expected: Any,
    actual: Any,
    correct: list[str],
    missing: list[str],
    different: list[dict[str, Any]],
) -> None:
    if actual in ("", None):
        missing.append(field)
        return
    if isinstance(expected, str):
        if normalize_string(expected) == normalize_string(actual):
            correct.append(field)
        else:
            different.append({"field": field, "expected": expected, "actual": actual})
        return
    if expected == actual:
        correct.append(field)
    else:
        different.append({"field": field, "expected": expected, "actual": actual})


def compare_numeric_group(
    field: str,
    expected: dict[str, float | None],
    actual: dict[str, float | None],
    correct: list[str],
    missing: list[str],
    different: list[dict[str, Any]],
) -> dict[str, float | None]:
    errors: dict[str, float | None] = {}
    for axis, expected_value in expected.items():
        actual_value = actual.get(axis)
        path = f"{field}.{axis}"
        errors[axis] = percentage_error(expected_value, actual_value)
        if actual_value is None:
            missing.append(path)
        elif expected_value == actual_value:
            correct.append(path)
        else:
            different.append(
                {
                    "field": path,
                    "expected": expected_value,
                    "actual": actual_value,
                    "percentage_error": errors[axis],
                }
            )
    return errors


def group_total(groups: list[dict[str, Any]]) -> int:
    return sum(int(group.get("count") or 0) for group in groups)


def feature_precision(expected_count: int, actual_count: int) -> dict[str, Any]:
    if actual_count == 0:
        precision = 1.0 if expected_count == 0 else 0.0
    else:
        precision = min(expected_count, actual_count) / actual_count
    recall = 1.0 if expected_count == 0 else min(expected_count, actual_count) / expected_count
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return {
        "expected_count": expected_count,
        "actual_count": actual_count,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def compare_features(
    expected: dict[str, list[dict[str, Any]]],
    actual: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    report: dict[str, Any] = {}
    for feature_name, expected_groups in expected.items():
        actual_groups = actual.get(feature_name, [])
        report[feature_name] = feature_precision(
            group_total(expected_groups),
            group_total(actual_groups),
        )
    overall_expected = sum(group_total(groups) for groups in expected.values())
    overall_actual = sum(group_total(groups) for groups in actual.values())
    report["overall"] = feature_precision(overall_expected, overall_actual)
    return report


def score_report(
    correct_fields: list[str],
    missing_fields: list[str],
    different_fields: list[dict[str, Any]],
    numeric_errors: dict[str, Any],
    feature_report: dict[str, Any],
) -> int:
    field_total = len(correct_fields) + len(missing_fields) + len(different_fields)
    field_score = 100.0 if field_total == 0 else len(correct_fields) / field_total * 100.0

    flat_errors = flatten_errors(numeric_errors)
    valid_errors = [error for error in flat_errors if error is not None]
    if valid_errors:
        numeric_score = sum(max(0.0, 100.0 - error) for error in valid_errors) / len(valid_errors)
    else:
        numeric_score = 0.0

    feature_score = float(feature_report.get("overall", {}).get("f1", 0.0)) * 100.0
    final_score = field_score * 0.4 + numeric_score * 0.35 + feature_score * 0.25
    return int(round(max(0.0, min(100.0, final_score))))


def flatten_errors(value: Any) -> list[float | None]:
    if isinstance(value, dict):
        errors: list[float | None] = []
        for nested in value.values():
            errors.extend(flatten_errors(nested))
        return errors
    if isinstance(value, list):
        errors = []
        for nested in value:
            errors.extend(flatten_errors(nested))
        return errors
    if isinstance(value, (float, int)) or value is None:
        return [value]
    return []


def evaluate(expected_data: dict[str, Any], actual_data: dict[str, Any]) -> dict[str, Any]:
    expected = normalize_ground_truth(expected_data)
    actual = normalize_extracted(actual_data)

    correct_fields: list[str] = []
    missing_fields: list[str] = []
    different_fields: list[dict[str, Any]] = []

    for field in ["part_name", "material"]:
        compare_scalar(
            field,
            expected[field],
            actual[field],
            correct_fields,
            missing_fields,
            different_fields,
        )

    numeric_errors: dict[str, Any] = {}
    for field in NUMERIC_FIELDS:
        expected_value = expected[field]
        actual_value = actual[field]
        numeric_errors[field] = percentage_error(expected_value, actual_value)
        if actual_value is None:
            missing_fields.append(field)
        elif expected_value == actual_value:
            correct_fields.append(field)
        else:
            different_fields.append(
                {
                    "field": field,
                    "expected": expected_value,
                    "actual": actual_value,
                    "percentage_error": numeric_errors[field],
                }
            )

    numeric_errors["dimensions_mm"] = compare_numeric_group(
        "dimensions_mm",
        expected["dimensions_mm"],
        actual["dimensions_mm"],
        correct_fields,
        missing_fields,
        different_fields,
    )
    numeric_errors["blank_size_mm"] = compare_numeric_group(
        "blank_size_mm",
        expected["blank_size_mm"],
        actual["blank_size_mm"],
        correct_fields,
        missing_fields,
        different_fields,
    )

    expected_steps = expected["process_steps"]
    actual_steps = actual["process_steps"]
    if not actual_steps:
        missing_fields.append("process_steps")
    elif expected_steps == actual_steps:
        correct_fields.append("process_steps")
    else:
        different_fields.append(
            {
                "field": "process_steps",
                "expected": expected_steps,
                "actual": actual_steps,
            }
        )

    feature_report = compare_features(expected["features"], actual["features"])
    for feature_name, result in feature_report.items():
        if feature_name == "overall":
            continue
        field = f"features.{feature_name}"
        if result["actual_count"] == 0 and result["expected_count"] > 0:
            missing_fields.append(field)
        elif result["expected_count"] == result["actual_count"]:
            correct_fields.append(field)
        else:
            different_fields.append(
                {
                    "field": field,
                    "expected": result["expected_count"],
                    "actual": result["actual_count"],
                }
            )

    final_score = score_report(
        correct_fields,
        missing_fields,
        different_fields,
        numeric_errors,
        feature_report,
    )

    return {
        "evaluation_type": "cad_extraction_accuracy",
        "correct_fields": correct_fields,
        "missing_fields": missing_fields,
        "different_fields": different_fields,
        "percentage_errors": numeric_errors,
        "feature_precision": feature_report,
        "cad_accuracy_score": final_score,
        "final_score": final_score,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare CAD extractor JSON with REVERSEPARTS ground truth."
    )
    parser.add_argument("cad_output_json", type=Path, help="CAD extractor output JSON path.")
    parser.add_argument("expected_json", type=Path, help="Ground truth JSON path.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Optional path for the evaluation report JSON.",
    )
    parser.add_argument("--pretty", action="store_true", help="Print indented JSON.")
    args = parser.parse_args()

    report = evaluate(load_json(args.expected_json), load_json(args.cad_output_json))
    serialized = json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None)
    if args.output:
        args.output.write_text(serialized + "\n", encoding="utf-8")
    else:
        sys.stdout.write(serialized + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
