"""Extract technical quote data from PDF documents.

The extractor is intentionally conservative: it only returns values found in
the PDF text and leaves unknown fields as null/empty arrays with warnings.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError as exc:  # pragma: no cover - exercised by CLI users.
    raise SystemExit(
        "Missing dependency: pdfplumber. Install with `pip install -r requirements.txt`."
    ) from exc


Number = int | float


def empty_output() -> dict[str, Any]:
    return {
        "part_name": "",
        "material": "",
        "thickness_mm": None,
        "dimensions_mm": {"x": None, "y": None, "z": None},
        "part_weight_kg": None,
        "blank_size_mm": {"x": None, "y": None},
        "blank_weight_kg": None,
        "blank_perimeter_mm": None,
        "features": {
            "circular_holes": [],
            "elongated_holes": [],
            "polygonal_holes": [],
            "flanges": [],
        },
        "process_steps": [],
        "warnings": [],
    }


def normalize_text(text: str) -> str:
    normalized = text.replace("\xa0", " ")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\r\n?", "\n", normalized)
    return normalized


def parse_number(value: str) -> float | None:
    cleaned = value.strip().replace(",", ".")
    cleaned = re.sub(r"[^0-9.+-]", "", cleaned)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def find_first_number(text: str, patterns: list[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return parse_number(match.group(1))
    return None


def find_labeled_value(text: str, labels: list[str]) -> str:
    label_pattern = "|".join(re.escape(label) for label in labels)
    pattern = rf"(?:{label_pattern})\s*[:=]\s*(.+)"
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return ""
    value = match.group(1).strip()
    return re.split(r"\s{2,}|\n", value)[0].strip(" -")


def find_dimensions(text: str, labels: list[str], axes: int) -> dict[str, float | None]:
    label_pattern = "|".join(re.escape(label) for label in labels)
    pattern = (
        rf"(?:{label_pattern})\s*[:=]?\s*"
        rf"([0-9]+(?:[.,][0-9]+)?)\s*[xX*]\s*"
        rf"([0-9]+(?:[.,][0-9]+)?)"
        rf"(?:\s*[xX*]\s*([0-9]+(?:[.,][0-9]+)?))?"
    )
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        keys = ("x", "y", "z") if axes == 3 else ("x", "y")
        return {key: None for key in keys}

    values = [parse_number(value) for value in match.groups() if value is not None]
    if axes == 3:
        return {
            "x": values[0] if len(values) > 0 else None,
            "y": values[1] if len(values) > 1 else None,
            "z": values[2] if len(values) > 2 else None,
        }
    return {
        "x": values[0] if len(values) > 0 else None,
        "y": values[1] if len(values) > 1 else None,
    }


def extract_count(text: str, keywords: list[str]) -> int | None:
    keyword_pattern = "|".join(re.escape(keyword) for keyword in keywords)
    patterns = [
        rf"([0-9]+)\s+(?:{keyword_pattern})",
        rf"(?:{keyword_pattern})\s*[:=]?\s*([0-9]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def extract_feature_groups(
    text: str,
    total_keywords: list[str],
    item_keywords: list[str],
    size_keywords: list[str],
    value_key: str,
) -> list[dict[str, Number | None]]:
    total_count = extract_count(text, total_keywords)
    item_pattern = "|".join(re.escape(keyword) for keyword in item_keywords)
    size_pattern = "|".join(re.escape(keyword) for keyword in size_keywords)
    groups: list[dict[str, Number | None]] = []

    for match in re.finditer(
        rf"([0-9]+)\s+(?:{item_pattern})[^\n]{{0,50}}"
        rf"(?:{size_pattern})\s*([0-9]+(?:[.,][0-9]+)?)",
        text,
        re.IGNORECASE,
    ):
        groups.append(
            {
                "count": int(match.group(1)),
                value_key: parse_number(match.group(2)),
            }
        )

    if not groups and total_count is not None:
        groups.append({"count": total_count, value_key: None})

    return groups


def extract_process_steps(text: str) -> list[str]:
    candidates = [
        ("sviluppo laser 2D", r"sviluppo\s+laser\s+2d|laser\s+2d"),
        ("piegatrice", r"piegatrice|pressa\s+piegatrice|press\s+brake"),
        ("taglio laser", r"taglio\s+laser"),
        ("punzonatura", r"punzonatura"),
    ]
    steps: list[str] = []
    for label, pattern in candidates:
        if re.search(pattern, text, re.IGNORECASE) and label not in steps:
            steps.append(label)
    return steps


def read_pdf_text(pdf_path: Path) -> tuple[str, list[str]]:
    warnings: list[str] = []
    pages: list[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages:
            warnings.append("PDF has no pages.")
        for page_number, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text() or ""
            if not page_text.strip():
                warnings.append(f"Page {page_number} has no extractable text.")
            pages.append(page_text)

    text = normalize_text("\n".join(pages))
    if len(text.strip()) < 50:
        warnings.append("PDF text extraction returned little readable content.")
    return text, warnings


def extract_from_text(text: str) -> dict[str, Any]:
    output = empty_output()

    output["part_name"] = find_labeled_value(
        text,
        ["Nome pezzo", "Part name", "Pezzo", "Componente", "Codice pezzo"],
    )
    output["material"] = find_labeled_value(
        text,
        ["Materiale", "Material", "Material code"],
    )
    output["thickness_mm"] = find_first_number(
        text,
        [
            r"(?:Spessore|Thickness)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*mm",
        ],
    )
    output["dimensions_mm"] = find_dimensions(
        text,
        ["Dimensioni pezzo", "Part dimensions", "Dimensioni", "Ingombro"],
        axes=3,
    )
    output["part_weight_kg"] = find_first_number(
        text,
        [
            r"(?:Peso pezzo|Part weight|Peso componente)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*kg",
        ],
    )
    output["blank_size_mm"] = find_dimensions(
        text,
        ["Blank size", "Sviluppo", "Dimensioni blank"],
        axes=2,
    )
    output["blank_weight_kg"] = find_first_number(
        text,
        [
            r"(?:Peso blank|Blank weight|Peso sviluppo)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*kg",
        ],
    )
    output["blank_perimeter_mm"] = find_first_number(
        text,
        [
            r"(?:Perimetro blank|Blank perimeter|Perimetro sviluppo)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*mm",
        ],
    )

    output["features"]["circular_holes"] = extract_feature_groups(
        text,
        ["Fori circolari", "Circular holes"],
        ["fori circolari", "foro circolare", "holes", "hole", "fori", "foro"],
        ["diametro", "diameter", "d."],
        "diameter_mm",
    )
    output["features"]["elongated_holes"] = extract_feature_groups(
        text,
        ["Fori asolati", "Asole", "Slotted holes", "Elongated holes"],
        ["fori asolati", "foro asolato", "asole", "asola", "slots", "slot"],
        ["lunghezza", "length", "da"],
        "length_mm",
    )
    output["features"]["polygonal_holes"] = extract_feature_groups(
        text,
        ["Fori poligonali", "Polygonal holes"],
        ["fori poligonali", "foro poligonale", "polygonal holes", "polygonal hole"],
        ["da", "size", "lato"],
        "size_mm",
    )
    output["features"]["flanges"] = extract_feature_groups(
        text,
        ["Flange", "Pieghe", "Bends"],
        ["flange", "pieghe", "piega", "bends", "bend"],
        ["da", "length", "lunghezza"],
        "length_mm",
    )
    output["process_steps"] = extract_process_steps(text)

    missing = missing_fields(output)
    if missing:
        output["warnings"].append("Missing fields: " + ", ".join(missing))
    return output


def missing_fields(output: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    scalar_fields = [
        "part_name",
        "material",
        "thickness_mm",
        "part_weight_kg",
        "blank_weight_kg",
        "blank_perimeter_mm",
    ]
    for field in scalar_fields:
        if output[field] in ("", None):
            missing.append(field)

    for field, values in [
        ("dimensions_mm", output["dimensions_mm"]),
        ("blank_size_mm", output["blank_size_mm"]),
    ]:
        if any(value is None for value in values.values()):
            missing.append(field)

    for field, values in output["features"].items():
        if not values:
            missing.append(f"features.{field}")

    if not output["process_steps"]:
        missing.append("process_steps")

    return missing


def extract_pdf(pdf_path: Path) -> dict[str, Any]:
    output = empty_output()
    try:
        text, warnings = read_pdf_text(pdf_path)
    except Exception as exc:  # pragma: no cover - depends on PDF parser internals.
        output["warnings"].append(f"Could not read PDF: {exc}")
        return output

    output = extract_from_text(text)
    output["warnings"] = warnings + output["warnings"]
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract REVERSEPARTS PDF data.")
    parser.add_argument("pdf_path", type=Path, help="Path to the technical PDF.")
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Print indented JSON output.",
    )
    args = parser.parse_args()

    result = extract_pdf(args.pdf_path)
    indent = 2 if args.pretty else None
    json.dump(result, sys.stdout, ensure_ascii=False, indent=indent)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
