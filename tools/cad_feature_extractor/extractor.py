"""Extract geometric quote features from CAD/3D files.

STL files are analyzed with trimesh. STEP/STP files are routed through
FreeCAD or pythonocc when those libraries are available locally; otherwise the
tool returns the expected JSON shape with warnings and null values.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


STL_EXTENSIONS = {".stl"}
STEP_EXTENSIONS = {".step", ".stp"}
SUPPORTED_EXTENSIONS = STL_EXTENSIONS | STEP_EXTENSIONS


def empty_output(file_type: str = "") -> dict[str, Any]:
    return {
        "file_type": file_type,
        "dimensions_mm": {"x": None, "y": None, "z": None},
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
        "bends_count": None,
        "flanges": [],
        "thickness_mm": None,
        "bounding_box": {},
        "complexity_score": "unknown",
        "warnings": [],
    }


def extract_features(
    file_path: str | Path,
    *,
    material_density_g_cm3: float | None = None,
) -> dict[str, Any]:
    path = Path(file_path)
    extension = path.suffix.lower()
    output = empty_output(extension.lstrip(".").upper())

    if not path.exists():
        output["warnings"].append(f"Input file not found: {path}")
        return output

    if extension not in SUPPORTED_EXTENSIONS:
        output["warnings"].append(
            "Unsupported file type. Supported extensions: "
            + ", ".join(sorted(SUPPORTED_EXTENSIONS))
        )
        return output

    if extension in STL_EXTENSIONS:
        return extract_stl(path, material_density_g_cm3)

    return extract_step(path, material_density_g_cm3)


def extract_stl(
    path: Path,
    material_density_g_cm3: float | None,
) -> dict[str, Any]:
    output = empty_output("STL")
    output["warnings"].append(
        "STL files do not store units; numeric values are interpreted as millimeters."
    )

    try:
        import numpy as np
        import trimesh
    except ImportError:
        output["warnings"].append(
            "STL analysis requires trimesh and numpy. Install with `pip install -r requirements.txt`."
        )
        return output

    try:
        loaded = trimesh.load_mesh(path, file_type="stl", force="mesh")
        mesh = coerce_to_mesh(loaded)
    except Exception as exc:
        output["warnings"].append(f"Could not load STL mesh: {exc}")
        return output

    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        output["warnings"].append("STL mesh has no usable vertices or faces.")
        return output

    bounds = np.asarray(mesh.bounds, dtype=float)
    extents = np.asarray(mesh.extents, dtype=float)
    center = np.asarray(mesh.bounding_box.centroid, dtype=float)

    volume_mm3 = abs(float(mesh.volume)) if mesh.is_watertight else None
    surface_area_mm2 = float(mesh.area)
    volume_cm3 = volume_mm3 / 1000.0 if volume_mm3 is not None else None
    surface_area_cm2 = surface_area_mm2 / 100.0

    if not mesh.is_watertight:
        output["warnings"].append(
            "Mesh is not watertight; volume, weight and through-hole counts may be unreliable."
        )
    if not mesh.is_winding_consistent:
        output["warnings"].append("Mesh winding is inconsistent.")

    hole_result = estimate_mesh_holes(mesh)
    output["warnings"].extend(hole_result["warnings"])

    triangle_count = int(len(mesh.faces))
    vertex_count = int(len(mesh.vertices))

    output.update(
        {
            "dimensions_mm": {
                "x": round_number(extents[0]),
                "y": round_number(extents[1]),
                "z": round_number(extents[2]),
            },
            "volume_cm3": round_nullable(volume_cm3),
            "surface_area_cm2": round_number(surface_area_cm2),
            "estimated_weight_kg": estimate_weight(volume_cm3, material_density_g_cm3),
            "holes_count": hole_result["holes_count"],
            "holes": hole_result["holes"],
            "features": {
                "circular_holes": [],
                "elongated_holes": [],
                "polygonal_holes": [],
                "flanges": [],
            },
            "bends_count": None,
            "flanges": [],
            "thickness_mm": None,
            "bounding_box": {
                "min_mm": {
                    "x": round_number(bounds[0][0]),
                    "y": round_number(bounds[0][1]),
                    "z": round_number(bounds[0][2]),
                },
                "max_mm": {
                    "x": round_number(bounds[1][0]),
                    "y": round_number(bounds[1][1]),
                    "z": round_number(bounds[1][2]),
                },
                "center_mm": {
                    "x": round_number(center[0]),
                    "y": round_number(center[1]),
                    "z": round_number(center[2]),
                },
                "triangle_count": triangle_count,
                "vertex_count": vertex_count,
                "is_watertight": bool(mesh.is_watertight),
            },
            "complexity_score": score_complexity(
                triangle_count=triangle_count,
                holes_count=hole_result["holes_count"],
                has_bends=False,
            ),
        }
    )

    output["warnings"].append(
        "STL is secondary for this workflow; use STP/STEP as the primary source for CAD features."
    )
    output["warnings"].append(
        "Bends, flanges, typed holes and sheet thickness cannot be inferred reliably from STL alone."
    )
    return output


def extract_step(
    path: Path,
    material_density_g_cm3: float | None,
) -> dict[str, Any]:
    freecad_result = extract_step_with_freecad(path, material_density_g_cm3)
    if freecad_result is not None:
        return freecad_result

    pythonocc_result = extract_step_with_pythonocc(path, material_density_g_cm3)
    if pythonocc_result is not None:
        return pythonocc_result

    output = empty_output(path.suffix.lstrip(".").upper())
    output["warnings"].extend(
        [
            "STEP/STP support requires FreeCAD Python or pythonocc-core/OpenCascade.",
            "No local STEP parser was available, so geometric fields were left as null.",
            "Install FreeCAD or pythonocc-core as described in README.md and rerun extraction.",
        ]
    )
    return output


def extract_step_with_freecad(
    path: Path,
    material_density_g_cm3: float | None,
) -> dict[str, Any] | None:
    try:
        import FreeCAD  # type: ignore[import-not-found]
        import Part  # type: ignore[import-not-found]
    except ImportError:
        return None

    output = empty_output(path.suffix.lstrip(".").upper())
    try:
        shape = Part.Shape()
        shape.read(str(path))
        bbox = shape.BoundBox
        volume_cm3 = float(shape.Volume) / 1000.0 if shape.Volume else None
        surface_area_cm2 = float(shape.Area) / 100.0 if shape.Area else None
        faces_count = len(shape.Faces)
        edges_count = len(shape.Edges)
        thickness_result = estimate_sheet_thickness_freecad(shape)
        hole_features = detect_holes_freecad(shape, thickness_result["thickness_mm"])
        bend_features = detect_bends_and_flanges_freecad(shape, hole_features["circular_holes"])
        holes = (
            hole_features["circular_holes"]
            + hole_features["elongated_holes"]
            + hole_features["polygonal_holes"]
        )
        holes_count = feature_count(holes)
    except Exception as exc:
        output["warnings"].append(f"FreeCAD could not analyze STEP file: {exc}")
        return output

    output.update(
        {
            "dimensions_mm": {
                "x": round_number(bbox.XLength),
                "y": round_number(bbox.YLength),
                "z": round_number(bbox.ZLength),
            },
            "volume_cm3": round_nullable(volume_cm3),
            "surface_area_cm2": round_nullable(surface_area_cm2),
            "estimated_weight_kg": estimate_weight(volume_cm3, material_density_g_cm3),
            "holes_count": holes_count,
            "holes": holes,
            "holes_debug_candidates_count": hole_features["debug_candidates_count"],
            "holes_detection_confidence": hole_features["detection_confidence"],
            "features": {
                "circular_holes": hole_features["circular_holes"],
                "elongated_holes": hole_features["elongated_holes"],
                "polygonal_holes": hole_features["polygonal_holes"],
                "flanges": bend_features["flanges"],
            },
            "bends_count": len(bend_features["flanges"]),
            "flanges": bend_features["flanges"],
            "thickness_mm": thickness_result["thickness_mm"],
            "bounding_box": {
                "min_mm": {
                    "x": round_number(bbox.XMin),
                    "y": round_number(bbox.YMin),
                    "z": round_number(bbox.ZMin),
                },
                "max_mm": {
                    "x": round_number(bbox.XMax),
                    "y": round_number(bbox.YMax),
                    "z": round_number(bbox.ZMax),
                },
                "faces_count": faces_count,
                "edges_count": edges_count,
            },
            "complexity_score": score_complexity(
                triangle_count=faces_count,
                holes_count=holes_count,
                has_bends=bool(bend_features["flanges"]),
            ),
        }
    )
    output["warnings"].extend(hole_features["warnings"])
    output["warnings"].extend(bend_features["warnings"])
    output["warnings"].extend(thickness_result["warnings"])
    return output


def extract_step_with_pythonocc(
    path: Path,
    material_density_g_cm3: float | None,
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

    output = empty_output(path.suffix.lstrip(".").upper())
    try:
        reader = STEPControl_Reader()
        status = reader.ReadFile(str(path))
        if status != IFSelect_RetDone:
            output["warnings"].append("pythonocc could not read STEP file.")
            return output
        reader.TransferRoots()
        shape = reader.OneShape()

        bbox = Bnd_Box()
        brepbndlib.Add(shape, bbox)
        xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()

        volume_props = GProp_GProps()
        brepgprop.VolumeProperties(shape, volume_props)
        volume_cm3 = float(volume_props.Mass()) / 1000.0

        surface_props = GProp_GProps()
        brepgprop.SurfaceProperties(shape, surface_props)
        surface_area_cm2 = float(surface_props.Mass()) / 100.0
    except Exception as exc:
        output["warnings"].append(f"pythonocc could not analyze STEP file: {exc}")
        return output

    output.update(
        {
            "dimensions_mm": {
                "x": round_number(xmax - xmin),
                "y": round_number(ymax - ymin),
                "z": round_number(zmax - zmin),
            },
            "volume_cm3": round_number(volume_cm3),
            "surface_area_cm2": round_number(surface_area_cm2),
            "estimated_weight_kg": estimate_weight(volume_cm3, material_density_g_cm3),
            "holes_count": None,
            "holes": [],
            "features": {
                "circular_holes": [],
                "elongated_holes": [],
                "polygonal_holes": [],
                "flanges": [],
            },
            "bends_count": None,
            "flanges": [],
            "thickness_mm": None,
            "bounding_box": {
                "min_mm": {
                    "x": round_number(xmin),
                    "y": round_number(ymin),
                    "z": round_number(zmin),
                },
                "max_mm": {
                    "x": round_number(xmax),
                    "y": round_number(ymax),
                    "z": round_number(zmax),
                },
            },
            "complexity_score": "unknown",
        }
    )
    output["warnings"].append(
        "pythonocc base extraction does not infer holes, bends, flanges or thickness yet."
    )
    return output


def detect_holes_freecad(
    shape: Any,
    sheet_thickness_mm: float | None = None,
) -> dict[str, Any]:
    circular_candidates: list[dict[str, Any]] = []
    seen: set[tuple[float, float, float, float]] = set()

    for face in getattr(shape, "Faces", []):
        surface = getattr(face, "Surface", None)
        radius = getattr(surface, "Radius", None)
        axis = getattr(surface, "Axis", None)
        if radius is None or axis is None:
            continue
        if not math.isfinite(float(radius)) or float(radius) <= 0:
            continue
        location = getattr(axis, "Location", None)
        direction = getattr(axis, "Direction", None)
        center = vector_to_dict(location)
        axis_dict = direction_to_dict(direction)
        key = (
            round(float(radius), 4),
            round(center["x"], 3),
            round(center["y"], 3),
            round(center["z"], 3),
        )
        if key in seen:
            continue
        seen.add(key)
        diameter_mm = float(radius) * 2.0
        circular_candidates.append(
            {
                "type": "circular_hole_candidate",
                "count": 1,
                "diameter_mm": round_number(diameter_mm),
                "center_mm": center,
                "axis": axis_dict,
                "confidence": score_cylindrical_hole_confidence(diameter_mm),
                "source": "FreeCAD cylindrical face",
            }
        )

    debug_candidates_count = len(circular_candidates)
    circular_holes = filter_confident_features(
        circular_candidates,
        "diameter_mm",
        sheet_thickness_mm,
    )
    detection_confidence = summarize_hole_confidence(circular_holes, debug_candidates_count)

    warnings: list[str] = []
    filtered_out = debug_candidates_count - feature_count(circular_holes)
    if filtered_out > 0:
        warnings.append(
            f"{filtered_out} low-confidence STEP hole candidates were kept out of main output."
        )
    if circular_holes:
        warnings.append(
            "Circular holes are deduplicated from cylindrical STEP faces and should be validated against ground truth."
        )
    else:
        warnings.append("No high-confidence circular holes were detected from STEP cylindrical faces.")

    warnings.append(
        "Elongated and polygonal hole detection needs explicit B-Rep contour recognition; left empty when not deducible."
    )

    return {
        "circular_holes": circular_holes,
        "elongated_holes": [],
        "polygonal_holes": [],
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
        if numeric_confidence(candidate.get("confidence")) >= 0.75
    ]
    deduped = dedupe_feature_candidates(confident, metric_key, sheet_thickness_mm)
    return group_feature_candidates(deduped, metric_key)


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

    if distance(candidate_center, existing_center) < 1.0:
        return True

    candidate_axis = normalized_axis(candidate.get("axis"))
    existing_axis = normalized_axis(existing.get("axis"))
    if candidate_axis is None or existing_axis is None:
        return False
    if abs(dot(candidate_axis, existing_axis)) < 0.97:
        return False

    delta = vector_delta(candidate_center, existing_center)
    axial_distance = abs(dot(delta, candidate_axis))
    radial_distance = math.sqrt(max(0.0, dot(delta, delta) - axial_distance**2))
    radial_tolerance = max(1.25, min(candidate_metric, existing_metric) * 0.08)
    thickness_tolerance = (
        max(2.0, float(sheet_thickness_mm) + 0.8)
        if isinstance(sheet_thickness_mm, (int, float)) and sheet_thickness_mm > 0
        else 3.0
    )
    return radial_distance <= radial_tolerance and axial_distance <= thickness_tolerance


def group_feature_candidates(
    features: list[dict[str, Any]],
    metric_key: str,
) -> list[dict[str, Any]]:
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

    return list(grouped.values())


def feature_count(features: list[dict[str, Any]]) -> int:
    return sum(int(feature.get("count") or 0) for feature in features)


def score_cylindrical_hole_confidence(diameter_mm: float) -> float:
    confidence = 0.65
    if 4.0 <= diameter_mm <= 18.0:
        confidence += 0.2
    if 18.0 < diameter_mm <= 40.0:
        confidence += 0.05
    if diameter_mm > 40.0:
        confidence -= 0.35
    return max(0.0, min(0.98, round(confidence, 2)))


def summarize_hole_confidence(features: list[dict[str, Any]], debug_candidates_count: int) -> str:
    if not features:
        return "low" if debug_candidates_count else "unknown"
    average = sum(numeric_confidence(feature.get("confidence")) for feature in features) / len(features)
    if average >= 0.9:
        return "high"
    if average >= 0.75:
        return "medium"
    return "low"


def vector_to_dict(vector: Any) -> dict[str, float]:
    return {
        "x": round_number(float(getattr(vector, "x", 0.0) or 0.0)),
        "y": round_number(float(getattr(vector, "y", 0.0) or 0.0)),
        "z": round_number(float(getattr(vector, "z", 0.0) or 0.0)),
    }


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


def numeric_confidence(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def as_float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def detect_bends_and_flanges_freecad(
    shape: Any,
    circular_holes: list[dict[str, Any]],
) -> dict[str, Any]:
    circular_diameters = {
        round(float(hole["diameter_mm"]), 4)
        for hole in circular_holes
        if isinstance(hole.get("diameter_mm"), (int, float))
    }
    flanges: list[dict[str, Any]] = []
    seen: set[tuple[float, float, float]] = set()

    for face in getattr(shape, "Faces", []):
        surface = getattr(face, "Surface", None)
        radius = getattr(surface, "Radius", None)
        axis = getattr(surface, "Axis", None)
        if radius is None or axis is None:
            continue

        diameter = round(float(radius) * 2.0, 4)
        if diameter in circular_diameters:
            continue

        area = float(getattr(face, "Area", 0.0) or 0.0)
        if area <= 0:
            continue

        location = getattr(axis, "Location", None)
        key = (
            round(float(radius), 4),
            round(float(getattr(location, "x", 0.0)), 3),
            round(float(getattr(location, "y", 0.0)), 3),
        )
        if key in seen:
            continue
        seen.add(key)
        flanges.append(
            {
                "type": "bend_or_flange_candidate",
                "count": 1,
                "radius_mm": round_number(float(radius)),
                "length_mm": None,
                "confidence": "low",
                "source": "FreeCAD cylindrical non-hole face",
            }
        )

    warnings: list[str] = []
    if flanges:
        warnings.append(
            "Bends/flanges are low-confidence candidates from non-hole cylindrical faces."
        )
    else:
        warnings.append("No bends/flanges were deducible from STEP geometry.")

    return {"flanges": flanges, "warnings": warnings}


def estimate_sheet_thickness_freecad(shape: Any) -> dict[str, Any]:
    distances: list[float] = []
    planar_faces: list[Any] = []

    for face in getattr(shape, "Faces", []):
        surface = getattr(face, "Surface", None)
        if surface and surface.__class__.__name__.lower().endswith("plane"):
            planar_faces.append(face)

    for index, first in enumerate(planar_faces):
        for second in planar_faces[index + 1 :]:
            distance = face_distance(first, second)
            if distance is not None and 0.1 <= distance <= 20:
                distances.append(round_number(distance))

    if not distances:
        return {
            "thickness_mm": None,
            "warnings": ["Sheet thickness was not deducible from parallel planar faces."],
        }

    buckets: dict[float, int] = {}
    for distance in distances:
        bucket = round(distance, 1)
        buckets[bucket] = buckets.get(bucket, 0) + 1

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


def face_distance(first: Any, second: Any) -> float | None:
    try:
        distance = first.distToShape(second)[0]
    except Exception:
        return None

    if not isinstance(distance, (int, float)) or not math.isfinite(float(distance)):
        return None
    return float(distance)


def coerce_to_mesh(loaded: Any) -> Any:
    import trimesh

    if isinstance(loaded, trimesh.Trimesh):
        return loaded
    if isinstance(loaded, trimesh.Scene):
        geometries = [
            geometry
            for geometry in loaded.geometry.values()
            if isinstance(geometry, trimesh.Trimesh)
        ]
        if geometries:
            return trimesh.util.concatenate(geometries)
    return trimesh.Trimesh()


def estimate_mesh_holes(mesh: Any) -> dict[str, Any]:
    warnings: list[str] = []
    holes: list[dict[str, Any]] = []

    if not mesh.is_watertight:
        warnings.append(
            "Hole detection on open STL meshes is limited to boundary loop openings."
        )
        boundary_loops = count_boundary_loops(mesh)
        for index in range(boundary_loops):
            holes.append(
                {
                    "type": "open_boundary_loop",
                    "diameter_mm": None,
                    "axis": None,
                    "confidence": "low",
                    "id": index + 1,
                }
            )
        return {"holes_count": len(holes), "holes": holes, "warnings": warnings}

    components = max(1, len(mesh.split(only_watertight=False)))
    genus = max(0, int(round((2 * components - int(mesh.euler_number)) / 2)))
    for index in range(genus):
        holes.append(
            {
                "type": "topological_tunnel",
                "diameter_mm": None,
                "axis": None,
                "confidence": "medium",
                "id": index + 1,
            }
        )

    if holes:
        warnings.append(
            "STL hole count is topological; diameters and axes require CAD/B-Rep analysis."
        )

    return {"holes_count": len(holes), "holes": holes, "warnings": warnings}


def count_boundary_loops(mesh: Any) -> int:
    try:
        import numpy as np
    except ImportError:
        return 0

    if len(mesh.faces) == 0:
        return 0

    edges = np.sort(mesh.edges_sorted, axis=1)
    unique_edges, counts = np.unique(edges, axis=0, return_counts=True)
    boundary_edges = unique_edges[counts == 1]
    if len(boundary_edges) == 0:
        return 0

    adjacency: dict[int, set[int]] = {}
    for start, end in boundary_edges:
        start_i = int(start)
        end_i = int(end)
        adjacency.setdefault(start_i, set()).add(end_i)
        adjacency.setdefault(end_i, set()).add(start_i)

    visited: set[int] = set()
    loops = 0
    for vertex in adjacency:
        if vertex in visited:
            continue
        loops += 1
        stack = [vertex]
        visited.add(vertex)
        while stack:
            current = stack.pop()
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
    return loops


def estimate_weight(
    volume_cm3: float | None,
    material_density_g_cm3: float | None,
) -> float | None:
    if volume_cm3 is None or material_density_g_cm3 is None:
        return None
    if material_density_g_cm3 < 0:
        return None
    return round_number(volume_cm3 * material_density_g_cm3 / 1000.0)


def score_complexity(
    *,
    triangle_count: int,
    holes_count: int | None,
    has_bends: bool,
) -> str:
    score = 0
    if triangle_count > 50_000:
        score += 2
    elif triangle_count > 10_000:
        score += 1

    if holes_count is not None:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract REVERSEPARTS CAD features.")
    parser.add_argument("file_path", type=Path, help="Path to STL, STEP or STP file.")
    parser.add_argument(
        "--density-g-cm3",
        type=float,
        default=None,
        help="Optional material density for estimated_weight_kg.",
    )
    parser.add_argument("--pretty", action="store_true", help="Print indented JSON.")
    args = parser.parse_args()

    result = extract_features(
        args.file_path,
        material_density_g_cm3=args.density_g_cm3,
    )
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
