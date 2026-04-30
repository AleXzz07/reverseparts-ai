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
        "Bends, flanges and sheet thickness cannot be inferred reliably from STL alone."
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
        holes = detect_cylindrical_holes_freecad(shape)
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
            "holes_count": len(holes),
            "holes": holes,
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
                holes_count=len(holes),
                has_bends=False,
            ),
        }
    )
    output["warnings"].append(
        "Bends, flanges and thickness require sheet-metal feature recognition and are not inferred."
    )
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


def detect_cylindrical_holes_freecad(shape: Any) -> list[dict[str, Any]]:
    holes: list[dict[str, Any]] = []
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
        key = (
            round(float(radius), 4),
            round(float(getattr(location, "x", 0.0)), 3),
            round(float(getattr(location, "y", 0.0)), 3),
            round(float(getattr(location, "z", 0.0)), 3),
        )
        if key in seen:
            continue
        seen.add(key)
        holes.append(
            {
                "type": "cylindrical_surface",
                "diameter_mm": round_number(float(radius) * 2.0),
                "axis": {
                    "x": round_number(float(getattr(direction, "x", 0.0))),
                    "y": round_number(float(getattr(direction, "y", 0.0))),
                    "z": round_number(float(getattr(direction, "z", 0.0))),
                },
                "confidence": "low",
            }
        )

    return holes


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
