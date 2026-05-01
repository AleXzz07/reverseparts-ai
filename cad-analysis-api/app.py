from __future__ import annotations

import math
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse


app = FastAPI(title="REVERSEPARTS CAD Analysis API", version="0.1.0")

STEP_EXTENSIONS = {".stp", ".step"}
SUPPORTED_UNITS = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "inch": 25.4}
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
        "volume_cm3": None,
        "surface_area_cm2": None,
        "estimated_weight_kg": None,
        "holes_count": None,
        "holes": [],
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

        result = analyze_with_freecad(input_path, density_g_cm3, unit_factor)
        if result is None:
            result = analyze_with_pythonocc(input_path, density_g_cm3, unit_factor)

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
        volume_cm3 = convert_volume_mm3_to_cm3(float(shape.Volume), unit_factor)
        surface_area_cm2 = convert_area_mm2_to_cm2(float(shape.Area), unit_factor)
        holes = detect_cylindrical_holes(shape, unit_factor)
        flanges = detect_bend_candidates(shape, holes, unit_factor)
        thickness = estimate_sheet_thickness(shape, unit_factor)
        faces_count = len(shape.Faces)
    except Exception as exc:
        output["warnings"].append(f"FreeCAD analysis failed: {exc}")
        return output

    output.update(
        {
            "dimensions_mm": {
                "x": round_number(float(bbox.XLength) * unit_factor),
                "y": round_number(float(bbox.YLength) * unit_factor),
                "z": round_number(float(bbox.ZLength) * unit_factor),
            },
            "volume_cm3": round_nullable(volume_cm3),
            "surface_area_cm2": round_nullable(surface_area_cm2),
            "estimated_weight_kg": estimate_weight(volume_cm3, density_g_cm3),
            "holes_count": feature_count(holes),
            "holes": holes,
            "bends_count": feature_count(flanges),
            "flanges": flanges,
            "thickness_mm": thickness["thickness_mm"],
            "complexity_score": score_complexity(faces_count, feature_count(holes), bool(flanges)),
        }
    )
    output["warnings"].extend(thickness["warnings"])
    if not holes:
        output["warnings"].append("No circular holes were deducible from STEP cylindrical faces.")
    if not flanges:
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


def detect_cylindrical_holes(shape: Any, unit_factor: float) -> list[dict[str, Any]]:
    holes: list[dict[str, Any]] = []
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
        location = getattr(axis, "Location", None)
        key = (
            round(radius_mm, 4),
            round(float(getattr(location, "x", 0.0)) * unit_factor, 3),
            round(float(getattr(location, "y", 0.0)) * unit_factor, 3),
            round(float(getattr(location, "z", 0.0)) * unit_factor, 3),
        )
        if key in seen:
            continue
        seen.add(key)
        holes.append(
            {
                "type": "circular_hole_candidate",
                "count": 1,
                "diameter_mm": round_number(radius_mm * 2.0),
                "confidence": "low",
                "source": "FreeCAD cylindrical face",
            }
        )
    return group_by_metric(holes, "diameter_mm")


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


def estimate_sheet_thickness(shape: Any, unit_factor: float) -> dict[str, Any]:
    planar_faces = []
    for face in getattr(shape, "Faces", []):
        surface = getattr(face, "Surface", None)
        if surface and surface.__class__.__name__.lower().endswith("plane"):
            planar_faces.append(face)

    distances: list[float] = []
    for index, first in enumerate(planar_faces):
        for second in planar_faces[index + 1 :]:
            try:
                distance = float(first.distToShape(second)[0]) * unit_factor
            except Exception:
                continue
            if math.isfinite(distance) and 0.1 <= distance <= 20:
                distances.append(round(distance, 1))

    if not distances:
        return {
            "thickness_mm": None,
            "warnings": ["Sheet thickness was not deducible from parallel planar faces."],
        }

    buckets: dict[float, int] = {}
    for distance in distances:
        buckets[distance] = buckets.get(distance, 0) + 1
    thickness, count = max(buckets.items(), key=lambda item: item[1])
    if count < 2:
        return {
            "thickness_mm": None,
            "warnings": ["Sheet thickness candidates were too weak to report."],
        }
    return {
        "thickness_mm": round_number(thickness),
        "warnings": ["Sheet thickness is estimated from repeated planar face offsets."],
    }


def group_by_metric(features: list[dict[str, Any]], metric_key: str) -> list[dict[str, Any]]:
    grouped: dict[float | None, dict[str, Any]] = {}
    for feature in features:
        metric = feature.get(metric_key)
        key = round(float(metric), 4) if isinstance(metric, (int, float)) else None
        if key not in grouped:
            grouped[key] = {**feature, "count": 0}
        grouped[key]["count"] += int(feature.get("count") or 1)
    return list(grouped.values())


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
