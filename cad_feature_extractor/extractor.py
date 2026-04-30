"""Geometry feature extraction for CAD/3D files.

Initial support is STL through trimesh. STEP/STP/IGES/IGS are intentionally
recognized but left behind a placeholder for a future FreeCAD/OpenCascade path.
"""

from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import trimesh


SUPPORTED_MESH_EXTENSIONS = {".stl"}
FUTURE_BREP_EXTENSIONS = {".step", ".stp", ".iges", ".igs"}


def extract_features(
    file_path: str | Path,
    *,
    material_density_g_cm3: float = 1.0,
) -> dict[str, Any]:
    """Extract a normalized technical JSON payload from a CAD/3D file.

    Args:
        file_path: Input file path.
        material_density_g_cm3: Density used to estimate mass from volume.

    Returns:
        Dictionary matching the public JSON contract.
    """

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")
    if material_density_g_cm3 < 0:
        raise ValueError("material_density_g_cm3 must be greater than or equal to 0")

    extension = path.suffix.lower()
    if extension in SUPPORTED_MESH_EXTENSIONS:
        return _extract_stl_features(path, material_density_g_cm3)
    if extension in FUTURE_BREP_EXTENSIONS:
        return _future_brep_placeholder(path)

    supported = sorted(SUPPORTED_MESH_EXTENSIONS | FUTURE_BREP_EXTENSIONS)
    raise ValueError(f"Unsupported file extension '{extension}'. Supported: {', '.join(supported)}")


def _extract_stl_features(path: Path, material_density_g_cm3: float) -> dict[str, Any]:
    try:
        import numpy as np
        import trimesh
    except ImportError as exc:
        raise RuntimeError(
            "STL extraction requires numpy and trimesh. Install them with: "
            "pip install -r cad_feature_extractor/requirements.txt"
        ) from exc

    warnings: list[str] = [
        "STL files do not store units; values are interpreted as millimeters.",
        "Hole detection for STL is topological and approximate, not parametric CAD recognition.",
    ]

    loaded = trimesh.load_mesh(path, file_type="stl", force="mesh")
    mesh = _coerce_to_mesh(loaded)

    if mesh.faces.size == 0 or mesh.vertices.size == 0:
        warnings.append("Mesh has no usable faces or vertices.")
        return _empty_payload(warnings)

    if not mesh.is_watertight:
        warnings.append("Mesh is not watertight; volume and hole estimates may be unreliable.")
    if not mesh.is_winding_consistent:
        warnings.append("Mesh winding is inconsistent; signed volume was normalized with abs().")

    bounds = np.asarray(mesh.bounds, dtype=float)
    extents = np.asarray(mesh.extents, dtype=float)
    center = np.asarray(mesh.centroid if mesh.is_volume else mesh.bounding_box.centroid, dtype=float)

    volume_mm3 = abs(float(mesh.volume)) if mesh.is_watertight else max(0.0, abs(float(mesh.volume)))
    volume_cm3 = volume_mm3 / 1000.0
    surface_area_cm2 = float(mesh.area) / 100.0

    hole_summary = _estimate_mesh_holes(mesh)
    warnings.extend(hole_summary["warnings"])

    face_count = int(len(mesh.faces))
    vertex_count = int(len(mesh.vertices))
    complexity_score = _score_complexity(face_count, vertex_count, hole_summary["holes_count"])

    return {
        "dimensions_mm": {
            "x": _round(extents[0]),
            "y": _round(extents[1]),
            "z": _round(extents[2]),
        },
        "volume_cm3": _round(volume_cm3),
        "surface_area_cm2": _round(surface_area_cm2),
        "estimated_weight_kg": _round(volume_cm3 * material_density_g_cm3 / 1000.0),
        "holes_count": hole_summary["holes_count"],
        "holes": hole_summary["holes"],
        "bounding_box": {
            "min_mm": {
                "x": _round(bounds[0][0]),
                "y": _round(bounds[0][1]),
                "z": _round(bounds[0][2]),
            },
            "max_mm": {
                "x": _round(bounds[1][0]),
                "y": _round(bounds[1][1]),
                "z": _round(bounds[1][2]),
            },
            "center_mm": {
                "x": _round(center[0]),
                "y": _round(center[1]),
                "z": _round(center[2]),
            },
            "extents_mm": {
                "x": _round(extents[0]),
                "y": _round(extents[1]),
                "z": _round(extents[2]),
            },
        },
        "complexity_score": complexity_score,
        "warnings": warnings,
    }


def _coerce_to_mesh(loaded: "trimesh.Trimesh | trimesh.Scene") -> "trimesh.Trimesh":
    import trimesh

    if isinstance(loaded, trimesh.Trimesh):
        return loaded
    if isinstance(loaded, trimesh.Scene):
        geometries = [geometry for geometry in loaded.geometry.values() if isinstance(geometry, trimesh.Trimesh)]
        if not geometries:
            return trimesh.Trimesh()
        return trimesh.util.concatenate(geometries)
    raise TypeError(f"Unsupported trimesh object: {type(loaded)!r}")


def _estimate_mesh_holes(mesh: "trimesh.Trimesh") -> dict[str, Any]:
    warnings: list[str] = []
    boundary_loops = _count_boundary_edge_loops(mesh)
    components = max(1, int(len(mesh.split(only_watertight=False))))
    euler_number = int(mesh.euler_number)

    genus_estimate = 0
    if mesh.is_watertight:
        genus_estimate = max(0, int(round((2 * components - euler_number) / 2)))
    elif boundary_loops:
        warnings.append("Open boundary loops detected; reporting boundary openings as mesh holes.")

    holes: list[dict[str, Any]] = []
    for index in range(genus_estimate):
        holes.append(
            {
                "id": index + 1,
                "type": "topological_tunnel",
                "confidence": "medium",
                "diameter_mm": None,
                "axis": None,
            }
        )

    if not mesh.is_watertight:
        for index in range(boundary_loops):
            holes.append(
                {
                    "id": len(holes) + 1,
                    "type": "open_boundary_loop",
                    "confidence": "low",
                    "diameter_mm": None,
                    "axis": None,
                }
            )

    return {
        "holes_count": len(holes),
        "holes": holes,
        "warnings": warnings,
    }


def _count_boundary_edge_loops(mesh: "trimesh.Trimesh") -> int:
    if len(mesh.faces) == 0:
        return 0

    import numpy as np

    edges = np.sort(mesh.edges_sorted, axis=1)
    unique_edges, counts = np.unique(edges, axis=0, return_counts=True)
    boundary_edges = unique_edges[counts == 1]
    if len(boundary_edges) == 0:
        return 0

    adjacency: dict[int, set[int]] = defaultdict(set)
    for start, end in boundary_edges:
        start_int = int(start)
        end_int = int(end)
        adjacency[start_int].add(end_int)
        adjacency[end_int].add(start_int)

    visited: set[int] = set()
    components = 0
    for vertex in adjacency:
        if vertex in visited:
            continue
        components += 1
        queue: deque[int] = deque([vertex])
        visited.add(vertex)
        while queue:
            current = queue.popleft()
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

    return components


def _score_complexity(face_count: int, vertex_count: int, holes_count: int) -> str:
    score = 0
    if face_count > 25_000 or vertex_count > 15_000:
        score += 2
    elif face_count > 5_000 or vertex_count > 3_000:
        score += 1

    if holes_count > 8:
        score += 2
    elif holes_count > 0:
        score += 1

    if score >= 3:
        return "high"
    if score >= 1:
        return "medium"
    return "low"


def _future_brep_placeholder(path: Path) -> dict[str, Any]:
    return _empty_payload(
        [
            f"{path.suffix.upper().lstrip('.')} support is reserved for a future FreeCAD/OpenCascade importer.",
            "Status: not_implemented.",
            "Install and integration plan: load B-Rep solids, tessellate when needed, then run parametric feature recognition.",
        ]
    )


def _empty_payload(warnings: list[str]) -> dict[str, Any]:
    return {
        "dimensions_mm": {"x": 0, "y": 0, "z": 0},
        "volume_cm3": 0,
        "surface_area_cm2": 0,
        "estimated_weight_kg": 0,
        "holes_count": 0,
        "holes": [],
        "bounding_box": {},
        "complexity_score": "low",
        "warnings": warnings,
    }


def _round(value: float) -> float:
    return round(float(value), 4)
