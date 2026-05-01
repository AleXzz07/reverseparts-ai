from __future__ import annotations

import math
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse


app = FastAPI(title="REVERSEPARTS CAD Analysis API", version="0.1.0")

STEP_EXTENSIONS = {".stp", ".step"}
SUPPORTED_UNITS = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "inch": 25.4}
HOLE_CONFIDENCE_THRESHOLD = 0.75
MIN_HOLE_DIAMETER_MM = 4.0
FREECAD_IMPORT_PATHS = [
    os.environ.get("FREECAD_PYTHON_PATH"),
    "/usr/lib/freecad/lib",
    "/usr/lib/freecad/Ext",
    "/usr/lib/freecad-python3/lib",
    "/usr/lib/python3/dist-packages",
    "/usr/local/lib/freecad/lib",
]


def empty_output() -> dict[str, Any]:
    return {
        "dimensions_mm": {"x": None, "y": None, "z": None},
        "raw_bounding_box_mm": {"x": None, "y": None, "z": None},
        "effective_dimensions_mm": None,
        "volume_cm3": None,
        "surface_area_cm2": None,
        "estimated_weight_kg": None,
        "holes_count": None,
        "holes": [],
        "holes_debug_candidates_count": 0,
        "holes_detection_confidence": "unknown",
        "features": {
            "circular_holes": [],
            "elongated_holes": [],
            "polygonal_holes": [],
            "flanges": [],
        },
        "flanges_count": None,
        "bends_count": None,
        "flanges": [],
        "thickness_mm": None,
        "complexity_score": "unknown",
        "warnings": [],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    freecad_available, freecad_error = check_freecad_import()
    return {
        "status": "ok",
        "freecad_available": freecad_available,
        "freecad_error": freecad_error,
        "python_path": sys.path,
    }


@app.post("/analyze-cad")
async def analyze_cad(
    file: UploadFile = File(...),
    materiale: str | None = Form(default=None),
    density_g_cm3: float | None = Form(default=None),
    unit: str = Form(default="mm"),
    notes: str | None = Form(default=None),
) -> JSONResponse:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in STEP_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only STP/STEP files are supported.")

    unit_factor = SUPPORTED_UNITS.get(unit.lower())
    if unit_factor is None:
        raise HTTPException(status_code=400, detail="unit must be one of: mm, cm, m, inch.")

    with tempfile.TemporaryDirectory(prefix="reverseparts-cad-") as tmp_dir:
        input_path = Path(tmp_dir) / safe_name(file.filename or f"part{extension}")
        input_path.write_bytes(await file.read())

        density = resolve_density(density_g_cm3, materiale, notes)
        result = analyze_with_freecad(input_path, density, unit_factor)
        if result is None:
            result = analyze_with_pythonocc(input_path, density, unit_factor)

    if result is None:
        output = empty_output()
        output["warnings"].append(
            "FreeCAD/OpenCascade non disponibile. Installare FreeCAD o pythonocc-core nel backend dedicato."
        )
        return JSONResponse(
            status_code=503,
            content={
                "error": "CAD kernel unavailable",
                "message": "FreeCAD/OpenCascade non disponibile nel backend Python.",
                "materiale": materiale,
                **output,
            },
        )

    result["warnings"].append(
        "Non inventare dati: feature non deducibili sono restituite come null o array vuoti."
    )
    if materiale:
        result["materiale"] = materiale
    if density is not None:
        result["density_g_cm3"] = density
    return JSONResponse(content=result)


def analyze_with_freecad(
    path: Path,
    density_g_cm3: float | None,
    unit_factor: float,
) -> dict[str, Any] | None:
    try:
        configure_freecad_paths()
        import FreeCAD  # type: ignore[import-not-found]  # noqa: F401
        import Part  # type: ignore[import-not-found]
    except ImportError as exc:
        print(f"FreeCAD import failed: {exc}", file=sys.stderr)
        return None

    output = empty_output()
    try:
        shape = Part.Shape()
        shape.read(str(path))
        bbox = shape.BoundBox
        raw_dimensions = bounding_box_dimensions(bbox, unit_factor)
        effective_dimensions = estimate_effective_dimensions(shape, unit_factor)
        volume_cm3 = convert_volume_mm3_to_cm3(float(shape.Volume), unit_factor)
        surface_area_cm2 = convert_area_mm2_to_cm2(float(shape.Area), unit_factor)
        thickness = estimate_sheet_thickness(shape, unit_factor)
        feature_result = detect_hole_features(shape, unit_factor, thickness["thickness_mm"])
        flange_result = detect_sheet_flange_features(shape, unit_factor)
        faces_count = len(shape.Faces)
        holes = (
            feature_result["circular_holes"]
            + feature_result["elongated_holes"]
            + feature_result["polygonal_holes"]
        )
    except Exception as exc:
        output["warnings"].append(f"FreeCAD analysis failed: {exc}")
        return output

    output.update(
        {
            "dimensions_mm": {
                "x": effective_dimensions["x"] if effective_dimensions else raw_dimensions["x"],
                "y": effective_dimensions["y"] if effective_dimensions else raw_dimensions["y"],
                "z": effective_dimensions["z"] if effective_dimensions else raw_dimensions["z"],
            },
            "raw_bounding_box_mm": raw_dimensions,
            "effective_dimensions_mm": effective_dimensions,
            "volume_cm3": round_nullable(volume_cm3),
            "surface_area_cm2": round_nullable(surface_area_cm2),
            "estimated_weight_kg": estimate_weight(volume_cm3, density_g_cm3),
            "holes_count": feature_count(holes),
            "holes": holes,
            "holes_debug_candidates_count": feature_result["debug_candidates_count"],
            "holes_detection_confidence": feature_result["detection_confidence"],
            "features": {
                "circular_holes": feature_result["circular_holes"],
                "elongated_holes": feature_result["elongated_holes"],
                "polygonal_holes": feature_result["polygonal_holes"],
                "flanges": flange_result["flanges"],
            },
            "flanges_count": feature_count(flange_result["flanges"]),
            "bends_count": feature_count(flange_result["flanges"]),
            "flanges": flange_result["flanges"],
            "thickness_mm": thickness["thickness_mm"],
            "complexity_score": score_complexity(faces_count, feature_count(holes), bool(flange_result["flanges"])),
        }
    )
    output["warnings"].extend(feature_result["warnings"])
    output["warnings"].extend(thickness["warnings"])
    output["warnings"].extend(flange_result["warnings"])
    if effective_dimensions:
        output["warnings"].append(
            "Effective dimensions estimated from dominant planar sheet faces; raw bounding box is preserved separately."
        )
    if not flange_result["flanges"]:
        output["warnings"].append("No bends/flanges were deducible from STEP geometry.")
    return output


def configure_freecad_paths() -> None:
    for candidate in FREECAD_IMPORT_PATHS:
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists() and str(path) not in sys.path:
            sys.path.append(str(path))


def check_freecad_import() -> tuple[bool, str | None]:
    try:
        configure_freecad_paths()
        import FreeCAD  # type: ignore[import-not-found]  # noqa: F401
        import Part  # type: ignore[import-not-found]  # noqa: F401
    except Exception as exc:
        return False, f"{exc.__class__.__name__}: {exc}"

    return True, None


def analyze_with_pythonocc(
    path: Path,
    density_g_cm3: float | None,
    unit_factor: float,
) -> dict[str, Any] | None:
    try:
        from OCC.Core.Bnd import Bnd_Box  # type: ignore[import-not-found]
        from OCC.Core.BRepBndLib import brepbndlib  # type: ignore[import-not-found]
        from OCC.Core.BRepGProp import brepgprop  # type: ignore[import-not-found]
        from OCC.Core.GProp import GProp_GProps  # type: ignore[import-not-found]
        from OCC.Core.IFSelect import IFSelect_RetDone  # type: ignore[import-not-found]
        from OCC.Core.STEPControl import STEPControl_Reader  # type: ignore[import-not-found]
    except ImportError:
        return None

    output = empty_output()
    try:
        reader = STEPControl_Reader()
        if reader.ReadFile(str(path)) != IFSelect_RetDone:
            output["warnings"].append("pythonocc could not read STEP file.")
            return output
        reader.TransferRoots()
        shape = reader.OneShape()

        bbox = Bnd_Box()
        brepbndlib.Add(shape, bbox)
        xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()

        volume_props = GProp_GProps()
        brepgprop.VolumeProperties(shape, volume_props)
        volume_cm3 = convert_volume_mm3_to_cm3(float(volume_props.Mass()), unit_factor)

        surface_props = GProp_GProps()
        brepgprop.SurfaceProperties(shape, surface_props)
        surface_area_cm2 = convert_area_mm2_to_cm2(float(surface_props.Mass()), unit_factor)
    except Exception as exc:
        output["warnings"].append(f"pythonocc analysis failed: {exc}")
        return output

    output.update(
        {
            "dimensions_mm": {
                "x": round_number((xmax - xmin) * unit_factor),
                "y": round_number((ymax - ymin) * unit_factor),
                "z": round_number((zmax - zmin) * unit_factor),
            },
            "raw_bounding_box_mm": {
                "x": round_number((xmax - xmin) * unit_factor),
                "y": round_number((ymax - ymin) * unit_factor),
                "z": round_number((zmax - zmin) * unit_factor),
            },
            "effective_dimensions_mm": None,
            "volume_cm3": round_nullable(volume_cm3),
            "surface_area_cm2": round_nullable(surface_area_cm2),
            "estimated_weight_kg": estimate_weight(volume_cm3, density_g_cm3),
            "complexity_score": "unknown",
        }
    )
    output["warnings"].append(
        "pythonocc fallback currently extracts dimensions, volume and area only."
    )
    return output


def bounding_box_dimensions(bbox: Any, unit_factor: float) -> dict[str, float]:
    return {
        "x": round_number(float(getattr(bbox, "XLength", 0.0) or 0.0) * unit_factor),
        "y": round_number(float(getattr(bbox, "YLength", 0.0) or 0.0) * unit_factor),
        "z": round_number(float(getattr(bbox, "ZLength", 0.0) or 0.0) * unit_factor),
    }


def estimate_effective_dimensions(shape: Any, unit_factor: float) -> dict[str, float] | None:
    planar_faces = [
        face
        for face in getattr(shape, "Faces", [])
        if is_planar_face(face) and float(getattr(face, "Area", 0.0) or 0.0) > 25
    ]
    if len(planar_faces) < 2:
        return None

    raw = bounding_box_dimensions(shape.BoundBox, unit_factor)
    effective: dict[str, float] = {}
    for axis, min_attr, max_attr in [
        ("x", "XMin", "XMax"),
        ("y", "YMin", "YMax"),
        ("z", "ZMin", "ZMax"),
    ]:
        intervals: list[tuple[float, float, float]] = []
        for face in planar_faces:
            bbox = getattr(face, "BoundBox", None)
            if bbox is None:
                continue
            start = float(getattr(bbox, min_attr, 0.0) or 0.0) * unit_factor
            end = float(getattr(bbox, max_attr, 0.0) or 0.0) * unit_factor
            length = end - start
            area = float(getattr(face, "Area", 0.0) or 0.0) * (unit_factor**2)
            if length <= 0.2:
                continue
            intervals.append((start, end, area))
        if not intervals:
            effective[axis] = raw[axis]
            continue
        max_area = max(area for _, _, area in intervals)
        strong = [(start, end) for start, end, area in intervals if area >= max_area * 0.08]
        if not strong:
            effective[axis] = raw[axis]
            continue
        length = max(end for _, end in strong) - min(start for start, _ in strong)
        effective[axis] = round_number(length)

    if any(effective[axis] <= 0 for axis in effective):
        return None
    if all(abs(effective[axis] - raw[axis]) < 0.1 for axis in effective):
        return None
    return effective


def is_planar_face(face: Any) -> bool:
    surface = getattr(face, "Surface", None)
    return bool(surface and surface.__class__.__name__.lower().endswith("plane"))


def detect_hole_features(
    shape: Any,
    unit_factor: float,
    sheet_thickness_mm: float | None = None,
) -> dict[str, Any]:
    circular_candidates: list[dict[str, Any]] = []
    elongated_candidates: list[dict[str, Any]] = []
    polygonal_candidates: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen: set[tuple[float, float, float, float]] = set()

    for face in getattr(shape, "Faces", []):
        surface = getattr(face, "Surface", None)
        radius = getattr(surface, "Radius", None)
        axis = getattr(surface, "Axis", None)
        if radius is None or axis is None:
            continue
        radius_mm = float(radius) * unit_factor
        if not math.isfinite(radius_mm) or radius_mm <= 0:
            continue
        diameter_mm = radius_mm * 2.0
        if diameter_mm < MIN_HOLE_DIAMETER_MM:
            continue
        if diameter_mm > 40:
            continue
        location = getattr(axis, "Location", None)
        center = vector_to_dict(location, unit_factor) if location is not None else face_center(face, unit_factor)
        axis_dict = axis_direction_to_dict(axis)
        key = (
            round(diameter_mm, 1),
            round(center["x"] / 1.0, 1),
            round(center["y"] / 1.0, 1),
            round(center["z"] / 1.0, 1),
        )
        if key in seen:
            continue
        seen.add(key)
        face_area = float(getattr(face, "Area", 0.0) or 0.0) * (unit_factor**2)
        confidence = score_cylindrical_hole_confidence(diameter_mm, face_area)
        circular_candidates.append(
            {
                "type": "circular_hole_candidate",
                "count": 1,
                "diameter_mm": round_number(diameter_mm),
                "center_mm": center,
                "axis": axis_dict,
                "confidence": confidence,
                "source": "FreeCAD cylindrical face",
            }
        )

    for face in main_planar_faces(shape):
        face_axis = face_axis_to_dict(face)
        for wire in inner_wires(face):
            polygon_result = classify_polygonal_wire(wire, unit_factor, face_axis)
            if polygon_result is not None:
                polygonal_candidates.append(polygon_result)
                continue
            elongated_result = classify_elongated_wire(wire, unit_factor, face_axis)
            if elongated_result is not None:
                elongated_candidates.append(elongated_result)

    debug_candidates_count = (
        len(circular_candidates) + len(elongated_candidates) + len(polygonal_candidates)
    )
    circular_holes = filter_confident_features(
        circular_candidates,
        "diameter_mm",
        sheet_thickness_mm,
    )
    elongated_holes = filter_confident_features(
        elongated_candidates,
        "length_mm",
        sheet_thickness_mm,
    )
    polygonal_holes = filter_confident_features(
        polygonal_candidates,
        "size_mm",
        sheet_thickness_mm,
    )

    detection_confidence = summarize_hole_confidence(
        circular_holes + elongated_holes + polygonal_holes,
        debug_candidates_count,
    )

    filtered_out = debug_candidates_count - (
        feature_count(circular_holes)
        + feature_count(elongated_holes)
        + feature_count(polygonal_holes)
    )
    if filtered_out > 0:
        warnings.append(
            f"{filtered_out} low-confidence STEP hole candidates were kept out of main output."
        )
    if detection_confidence != "high":
        warnings.append("Rilevamento fori da STEP da verificare su CAD/metrologia.")

    if not circular_holes:
        warnings.append("No high-confidence circular holes were deducible from STEP geometry.")
    if not elongated_holes:
        warnings.append("No high-confidence elongated holes were deducible from STEP geometry.")
    if not polygonal_holes:
        warnings.append("No high-confidence polygonal holes were deducible from STEP geometry.")

    return {
        "circular_holes": circular_holes,
        "elongated_holes": elongated_holes,
        "polygonal_holes": polygonal_holes,
        "debug_candidates_count": debug_candidates_count,
        "detection_confidence": detection_confidence,
        "warnings": warnings,
    }


def filter_confident_features(
    candidates: list[dict[str, Any]],
    metric_key: str,
    sheet_thickness_mm: float | None = None,
) -> list[dict[str, Any]]:
    confident = [
        candidate
        for candidate in candidates
        if numeric_confidence(candidate.get("confidence")) >= HOLE_CONFIDENCE_THRESHOLD
    ]
    deduped = dedupe_feature_candidates(confident, metric_key, sheet_thickness_mm)
    return group_by_metric(deduped, metric_key)


def dedupe_feature_candidates(
    candidates: list[dict[str, Any]],
    metric_key: str,
    sheet_thickness_mm: float | None = None,
) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    for candidate in sorted(
        candidates,
        key=lambda item: numeric_confidence(item.get("confidence")),
        reverse=True,
    ):
        if any(
            is_duplicate_candidate(candidate, existing, metric_key, sheet_thickness_mm)
            for existing in deduped
        ):
            continue
        deduped.append(candidate)
    return deduped


def is_duplicate_candidate(
    candidate: dict[str, Any],
    existing: dict[str, Any],
    metric_key: str,
    sheet_thickness_mm: float | None = None,
) -> bool:
    candidate_metric = as_float(candidate.get(metric_key))
    existing_metric = as_float(existing.get(metric_key))
    if candidate_metric is None or existing_metric is None:
        return False
    metric_tolerance = max(0.35, min(candidate_metric, existing_metric) * 0.03)
    if abs(candidate_metric - existing_metric) > metric_tolerance:
        return False
    candidate_center = candidate.get("center_mm")
    existing_center = existing.get("center_mm")
    if not isinstance(candidate_center, dict) or not isinstance(existing_center, dict):
        return False
    center_distance = distance(candidate_center, existing_center)
    if center_distance < 1.0:
        return True

    candidate_axis = normalized_axis(candidate.get("axis"))
    existing_axis = normalized_axis(existing.get("axis"))
    if candidate_axis is None or existing_axis is None:
        return False
    if abs(dot(candidate_axis, existing_axis)) < 0.97:
        return False

    delta = vector_delta(candidate_center, existing_center)
    axis = candidate_axis
    axial_distance = abs(dot(delta, axis))
    radial_distance = math.sqrt(max(0.0, dot(delta, delta) - axial_distance**2))
    radial_tolerance = max(1.25, min(candidate_metric, existing_metric) * 0.08)
    thickness_tolerance = (
        max(2.0, float(sheet_thickness_mm) + 0.8)
        if isinstance(sheet_thickness_mm, (int, float)) and sheet_thickness_mm > 0
        else 3.0
    )
    return radial_distance <= radial_tolerance and axial_distance <= thickness_tolerance


def numeric_confidence(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def summarize_hole_confidence(features: list[dict[str, Any]], debug_candidates_count: int) -> str:
    if not features:
        return "low" if debug_candidates_count else "unknown"
    average = sum(numeric_confidence(feature.get("confidence")) for feature in features) / len(features)
    if average >= 0.85:
        return "high"
    if average >= HOLE_CONFIDENCE_THRESHOLD:
        return "medium"
    return "low"


def main_planar_faces(shape: Any) -> list[Any]:
    planar_faces = []
    for face in getattr(shape, "Faces", []):
        if is_planar_face(face):
            planar_faces.append(face)
    if not planar_faces:
        return []
    max_area = max(float(getattr(face, "Area", 0.0) or 0.0) for face in planar_faces)
    return [
        face
        for face in planar_faces
        if float(getattr(face, "Area", 0.0) or 0.0) >= max_area * 0.08
    ]


def inner_wires(face: Any) -> list[Any]:
    wires = list(getattr(face, "Wires", []) or [])
    if len(wires) <= 1:
        return []
    return sorted(wires, key=lambda wire: float(getattr(wire, "Length", 0.0) or 0.0))[:-1]


def classify_elongated_wire(
    wire: Any,
    unit_factor: float,
    axis: dict[str, float] | None,
) -> dict[str, Any] | None:
    edges = getattr(wire, "Edges", []) or []
    if len(edges) < 4 or len(edges) > 12:
        return None
    circle_edges = 0
    line_edges = 0
    for edge in edges:
        curve_name = edge.Curve.__class__.__name__.lower()
        if "circle" in curve_name or "arc" in curve_name:
            circle_edges += 1
        if "line" in curve_name:
            line_edges += 1
    if circle_edges < 2 or line_edges < 2:
        return None
    length_mm = float(getattr(wire, "Length", 0.0) or 0.0) * unit_factor
    if length_mm < 20 or length_mm > 200:
        return None
    return {
        "type": "elongated_hole_candidate",
        "count": 1,
        "length_mm": round_number(length_mm / 2.0),
        "center_mm": wire_center(wire, unit_factor),
        "axis": axis,
        "confidence": 0.9,
        "source": "FreeCAD closed wire arc/line mix",
    }


def classify_polygonal_wire(
    wire: Any,
    unit_factor: float,
    axis: dict[str, float] | None,
) -> dict[str, Any] | None:
    edges = getattr(wire, "Edges", []) or []
    if len(edges) < 3 or len(edges) > 12:
        return None
    line_edges = 0
    for edge in edges:
        curve_name = edge.Curve.__class__.__name__.lower()
        if "line" in curve_name:
            line_edges += 1
    if line_edges != len(edges):
        return None
    length_mm = float(getattr(wire, "Length", 0.0) or 0.0) * unit_factor
    if length_mm < 12 or length_mm > 180:
        return None
    return {
        "type": "polygonal_hole_candidate",
        "count": 1,
        "size_mm": round_number(length_mm / max(1, len(edges))),
        "center_mm": wire_center(wire, unit_factor),
        "axis": axis,
        "confidence": 0.9,
        "source": "FreeCAD closed wire with linear edges",
    }


def score_cylindrical_hole_confidence(diameter_mm: float, face_area_mm2: float) -> float:
    confidence = 0.65
    if 4.0 <= diameter_mm <= 18.0:
        confidence += 0.2
    if face_area_mm2 <= max(120.0, diameter_mm * 18.0):
        confidence += 0.1
    if face_area_mm2 > max(300.0, diameter_mm * 50.0):
        confidence -= 0.25
    return max(0.0, min(0.98, round(confidence, 2)))


def face_center(face: Any, unit_factor: float) -> dict[str, float]:
    center = getattr(face, "CenterOfMass", None)
    if center is None:
        center = getattr(getattr(face, "BoundBox", None), "Center", None)
    return vector_to_dict(center, unit_factor)


def wire_center(wire: Any, unit_factor: float) -> dict[str, float]:
    center = getattr(getattr(wire, "BoundBox", None), "Center", None)
    return vector_to_dict(center, unit_factor)


def vector_to_dict(vector: Any, unit_factor: float) -> dict[str, float]:
    return {
        "x": round_number(float(getattr(vector, "x", 0.0) or 0.0) * unit_factor),
        "y": round_number(float(getattr(vector, "y", 0.0) or 0.0) * unit_factor),
        "z": round_number(float(getattr(vector, "z", 0.0) or 0.0) * unit_factor),
    }


def axis_direction_to_dict(axis: Any) -> dict[str, float] | None:
    return direction_to_dict(getattr(axis, "Direction", None))


def face_axis_to_dict(face: Any) -> dict[str, float] | None:
    try:
        return direction_to_dict(face.Surface.Axis.Direction)
    except Exception:
        return None


def direction_to_dict(direction: Any) -> dict[str, float] | None:
    if direction is None:
        return None
    vector = {
        "x": float(getattr(direction, "x", 0.0) or 0.0),
        "y": float(getattr(direction, "y", 0.0) or 0.0),
        "z": float(getattr(direction, "z", 0.0) or 0.0),
    }
    magnitude = math.sqrt(vector["x"] ** 2 + vector["y"] ** 2 + vector["z"] ** 2)
    if magnitude <= 0:
        return None
    return {
        "x": round_number(vector["x"] / magnitude),
        "y": round_number(vector["y"] / magnitude),
        "z": round_number(vector["z"] / magnitude),
    }


def distance(first: dict[str, Any], second: dict[str, Any]) -> float:
    return math.sqrt(
        (float(first.get("x", 0.0)) - float(second.get("x", 0.0))) ** 2
        + (float(first.get("y", 0.0)) - float(second.get("y", 0.0))) ** 2
        + (float(first.get("z", 0.0)) - float(second.get("z", 0.0))) ** 2
    )


def vector_delta(first: dict[str, Any], second: dict[str, Any]) -> tuple[float, float, float]:
    return (
        float(first.get("x", 0.0)) - float(second.get("x", 0.0)),
        float(first.get("y", 0.0)) - float(second.get("y", 0.0)),
        float(first.get("z", 0.0)) - float(second.get("z", 0.0)),
    )


def normalized_axis(value: Any) -> tuple[float, float, float] | None:
    if not isinstance(value, dict):
        return None
    try:
        vector = (
            float(value.get("x", 0.0)),
            float(value.get("y", 0.0)),
            float(value.get("z", 0.0)),
        )
    except (TypeError, ValueError):
        return None
    magnitude = math.sqrt(dot(vector, vector))
    if magnitude <= 0:
        return None
    return (vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude)


def dot(first: tuple[float, float, float], second: tuple[float, float, float]) -> float:
    return first[0] * second[0] + first[1] * second[1] + first[2] * second[2]


def as_float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def detect_bend_candidates(
    shape: Any,
    holes: list[dict[str, Any]],
    unit_factor: float,
) -> list[dict[str, Any]]:
    hole_diameters = {
        round(float(hole["diameter_mm"]), 4)
        for hole in holes
        if isinstance(hole.get("diameter_mm"), (int, float))
    }
    flanges: list[dict[str, Any]] = []
    for face in getattr(shape, "Faces", []):
        surface = getattr(face, "Surface", None)
        radius = getattr(surface, "Radius", None)
        if radius is None:
            continue
        radius_mm = float(radius) * unit_factor
        if round(radius_mm * 2.0, 4) in hole_diameters:
            continue
        flanges.append(
            {
                "type": "bend_or_flange_candidate",
                "count": 1,
                "radius_mm": round_number(radius_mm),
                "length_mm": None,
                "confidence": "low",
                "source": "FreeCAD cylindrical non-hole face",
            }
        )
    return group_by_metric(flanges, "radius_mm")


def detect_sheet_flange_features(shape: Any, unit_factor: float) -> dict[str, Any]:
    planar_faces = [
        face
        for face in getattr(shape, "Faces", [])
        if is_planar_face(face) and float(getattr(face, "Area", 0.0) or 0.0) > 50
    ]
    warnings: list[str] = []
    if len(planar_faces) < 2:
        return {
            "flanges": [],
            "warnings": ["Sheet flange detection found too few planar faces."],
        }

    main_face = max(planar_faces, key=lambda face: float(getattr(face, "Area", 0.0) or 0.0))
    main_axis = face_axis_tuple(main_face)
    if main_axis is None:
        return {
            "flanges": [],
            "warnings": ["Sheet flange detection could not identify a main plane normal."],
        }

    max_area = float(getattr(main_face, "Area", 0.0) or 0.0) * (unit_factor**2)
    candidates: list[dict[str, Any]] = []
    for face in planar_faces:
        axis = face_axis_tuple(face)
        if axis is None:
            continue
        parallel = abs(dot(main_axis, axis))
        if parallel >= 0.92:
            continue
        area = float(getattr(face, "Area", 0.0) or 0.0) * (unit_factor**2)
        if area < max(80.0, max_area * 0.12):
            continue
        length_mm = dominant_face_span(face, unit_factor)
        if length_mm is None or length_mm < 15:
            continue
        candidates.append(
            {
                "type": "simple_flange_candidate",
                "count": 1,
                "length_mm": round_number(length_mm),
                "center_mm": face_center(face, unit_factor),
                "confidence": 0.82,
                "source": "FreeCAD planar face not parallel to main sheet plane",
                "axis": direction_tuple_to_dict(axis),
            }
        )

    flanges = group_by_metric(
        dedupe_feature_candidates(candidates, "length_mm", None),
        "length_mm",
    )
    if flanges:
        warnings.append("Flanges estimated from major planar faces angled against the main sheet plane.")
    else:
        warnings.append("No high-confidence sheet flanges were deducible from planar face orientation.")
    return {"flanges": flanges, "warnings": warnings}


def face_axis_tuple(face: Any) -> tuple[float, float, float] | None:
    try:
        return normalized_axis(direction_to_dict(face.Surface.Axis.Direction))
    except Exception:
        return None


def direction_tuple_to_dict(axis: tuple[float, float, float]) -> dict[str, float]:
    return {"x": round_number(axis[0]), "y": round_number(axis[1]), "z": round_number(axis[2])}


def dominant_face_span(face: Any, unit_factor: float) -> float | None:
    bbox = getattr(face, "BoundBox", None)
    if bbox is None:
        return None
    spans = [
        float(getattr(bbox, "XLength", 0.0) or 0.0) * unit_factor,
        float(getattr(bbox, "YLength", 0.0) or 0.0) * unit_factor,
        float(getattr(bbox, "ZLength", 0.0) or 0.0) * unit_factor,
    ]
    spans = [span for span in spans if span > 0.2]
    if not spans:
        return None
    return max(spans)


def estimate_sheet_thickness(shape: Any, unit_factor: float) -> dict[str, Any]:
    planar_faces = []
    for face in getattr(shape, "Faces", []):
        if is_planar_face(face) and float(getattr(face, "Area", 0.0) or 0.0) > 20:
            planar_faces.append(face)

    distances: list[float] = []
    for index, first in enumerate(planar_faces):
        for second in planar_faces[index + 1 :]:
            if not are_parallel_planes(first, second):
                continue
            try:
                distance = float(first.distToShape(second)[0]) * unit_factor
            except Exception:
                continue
            if math.isfinite(distance) and 0.4 <= distance <= 6:
                distances.append(round(distance, 2))

    if not distances:
        return {
            "thickness_mm": None,
            "warnings": ["Sheet thickness was not deducible from parallel planar faces."],
        }

    buckets: dict[float, int] = {}
    for distance in distances:
        bucket = round(distance * 10.0) / 10.0
        buckets[bucket] = buckets.get(bucket, 0) + 1
    sorted_buckets = sorted(buckets.items(), key=lambda item: (-item[1], item[0]))
    thickness, count = sorted_buckets[0]
    sorted_counts = sorted(buckets.values(), reverse=True)
    ambiguous = len(sorted_counts) > 1 and sorted_counts[1] >= count * 0.9
    if count < 2 or ambiguous:
        return {
            "thickness_mm": None,
            "warnings": [
                "Sheet thickness candidates were ambiguous; returning null instead of a likely wrong value."
            ],
        }
    if thickness > 4.0 and any(abs(candidate - thickness / 2.0) <= 0.3 for candidate in buckets):
        return {
            "thickness_mm": None,
            "warnings": [
                "Sheet thickness candidate may be a doubled offset; returning null pending CAD validation."
            ],
        }
    return {
        "thickness_mm": round_number(thickness),
        "warnings": ["Sheet thickness is estimated from dominant nearby parallel planar faces."],
    }


def are_parallel_planes(first: Any, second: Any) -> bool:
    try:
        first_axis = first.Surface.Axis.Direction
        second_axis = second.Surface.Axis.Direction
        dot = abs(
            float(first_axis.x) * float(second_axis.x)
            + float(first_axis.y) * float(second_axis.y)
            + float(first_axis.z) * float(second_axis.z)
        )
    except Exception:
        return False
    return dot >= 0.995


def are_similar_large_faces(first: Any, second: Any) -> bool:
    first_area = float(getattr(first, "Area", 0.0) or 0.0)
    second_area = float(getattr(second, "Area", 0.0) or 0.0)
    if first_area <= 50 or second_area <= 50:
        return False
    ratio = min(first_area, second_area) / max(first_area, second_area)
    return ratio >= 0.65


def group_by_metric(features: list[dict[str, Any]], metric_key: str) -> list[dict[str, Any]]:
    grouped: dict[float | None, dict[str, Any]] = {}
    for feature in features:
        metric = feature.get(metric_key)
        key = round(float(metric), 4) if isinstance(metric, (int, float)) else None
        if key not in grouped:
            grouped[key] = {**feature, "count": 0}
        grouped[key]["count"] += int(feature.get("count") or 1)
        grouped[key]["confidence"] = max(
            numeric_confidence(grouped[key].get("confidence")),
            numeric_confidence(feature.get("confidence")),
        )
    return sorted(
        grouped.values(),
        key=lambda item: (str(item.get("type", "")), float(item.get(metric_key) or 0.0)),
    )


def feature_count(features: list[dict[str, Any]]) -> int:
    return sum(int(feature.get("count") or 0) for feature in features)


def convert_volume_mm3_to_cm3(volume: float, unit_factor: float) -> float | None:
    if not math.isfinite(volume):
        return None
    return volume * (unit_factor**3) / 1000.0


def convert_area_mm2_to_cm2(area: float, unit_factor: float) -> float | None:
    if not math.isfinite(area):
        return None
    return area * (unit_factor**2) / 100.0


def estimate_weight(volume_cm3: float | None, density_g_cm3: float | None) -> float | None:
    if volume_cm3 is None or density_g_cm3 is None or density_g_cm3 < 0:
        return None
    return round_number(volume_cm3 * density_g_cm3 / 1000.0)


def resolve_density(
    density_g_cm3: float | None,
    materiale: str | None,
    notes: str | None,
) -> float | None:
    if density_g_cm3 is not None and density_g_cm3 >= 0:
        return density_g_cm3
    for text in [materiale, notes]:
        parsed = parse_density_from_text(text or "")
        if parsed is not None:
            return parsed
    return None


def parse_density_from_text(text: str) -> float | None:
    density_label = r"(?:density|densit(?:a|à|Ã |a'))"
    density_unit = (
        r"(?:g\s*/\s*cm\s*(?:3|\^3|³)|"
        r"g\s*cm\s*(?:-3|\^-3|−3)|"
        r"g/cm3|g/cm\^3|g/cm³)"
    )
    explicit_density = re.search(
        rf"{density_label}\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*{density_unit}",
        text,
        re.IGNORECASE,
    )
    if explicit_density:
        value = float(explicit_density.group(1).replace(",", "."))
        if 0 <= value <= 30:
            return value

    value_with_unit = re.search(
        rf"([0-9]+(?:[.,][0-9]+)?)\s*{density_unit}",
        text,
        re.IGNORECASE,
    )
    if value_with_unit:
        value = float(value_with_unit.group(1).replace(",", "."))
        if 0 <= value <= 30:
            return value

    patterns = [
        r"(?:density|densita|densità)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:g\s*/\s*cm3|g\s*/\s*cm\^3|g/cm3|g/cm\^3)",
        r"([0-9]+(?:[.,][0-9]+)?)\s*(?:g\s*/\s*cm3|g\s*/\s*cm\^3|g/cm3|g/cm\^3)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        value = float(match.group(1).replace(",", "."))
        if 0 <= value <= 30:
            return value
    return None


def score_complexity(face_count: int, holes_count: int, has_bends: bool) -> str:
    score = 0
    if face_count > 1000:
        score += 2
    elif face_count > 250:
        score += 1
    if holes_count > 10:
        score += 2
    elif holes_count > 0:
        score += 1
    if has_bends:
        score += 1
    if score >= 3:
        return "high"
    if score >= 1:
        return "medium"
    return "low"


def round_number(value: float) -> float:
    return round(float(value), 4)


def round_nullable(value: float | None) -> float | None:
    return None if value is None else round_number(value)


def safe_name(file_name: str) -> str:
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in file_name)
