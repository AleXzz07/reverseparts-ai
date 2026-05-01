# CAD Feature Extractor

Standalone Python tool for extracting geometric features from CAD/3D files for REVERSEPARTS quoting workflows.

This module is not connected to the Next.js app.

STP/STEP is the primary technical data source. PDF files and `expected_output.json`
are ground truth references used to validate whether CAD extraction is correct.

## Supported Inputs

- STEP/STP via FreeCAD Python if available
- STEP/STP via `pythonocc-core`/OpenCascade if available
- STL via `trimesh` as a secondary mesh fallback

If a STEP/STP parser is not available locally, the extractor still returns the required JSON contract with `null` values and warnings. It does not invent technical data.

## Install

For STL support:

```bash
pip install -r requirements.txt
```

For STEP/STP support with FreeCAD:

1. Install FreeCAD from https://www.freecad.org/
2. Run this tool with FreeCAD's Python interpreter, or add FreeCAD's `bin`/Python paths to `PYTHONPATH`.
3. Verify imports:

```bash
python -c "import FreeCAD, Part; print('FreeCAD OK')"
```

For STEP/STP support with OpenCascade:

```bash
conda install -c conda-forge pythonocc-core
```

Then verify:

```bash
python -c "from OCC.Core.STEPControl import STEPControl_Reader; print('pythonocc OK')"
```

## Usage

```bash
python extractor.py path/to/part.stp --pretty
```

With material density for weight estimation:

```bash
python extractor.py path/to/part.stp --density-g-cm3 2.7 --pretty
```

Common densities:

- Aluminum: `2.7`
- Steel: `7.85`
- ABS: `1.04`
- PLA: `1.24`

## Output

The tool emits JSON with this shape:

```json
{
  "file_type": "",
  "dimensions_mm": {"x": null, "y": null, "z": null},
  "volume_cm3": null,
  "surface_area_cm2": null,
  "estimated_weight_kg": null,
  "holes_count": null,
  "holes": [],
  "holes_debug_candidates_count": 0,
  "holes_detection_confidence": "unknown",
  "features": {
    "circular_holes": [],
    "elongated_holes": [],
    "polygonal_holes": [],
    "flanges": []
  },
  "bends_count": null,
  "flanges": [],
  "thickness_mm": null,
  "bounding_box": {},
  "complexity_score": "unknown",
  "warnings": []
}
```

## Extraction Rules

- Missing data remains `null`, `{}` or `[]`.
- STEP/STP is the primary source for dimensions, volume, area, holes, bends, flanges and sheet thickness.
- STEP/STP extraction uses local FreeCAD/OpenCascade capabilities when available.
- Sheet thickness, bends and typed holes are reported only when they are deducible from geometry.
- `holes_count` counts deduplicated physical features, not raw edges or repeated loops.
- Raw STEP candidates are summarized separately in `holes_debug_candidates_count`.
- Through-hole loops on opposite sheet faces are merged when center, metric, axis and sheet thickness are compatible.
- STL units are not stored in the file; values are interpreted as millimeters.
- STL extraction calculates bounding box, volume when watertight, surface area and triangle count.
- STL hole detection is topological and cannot determine parametric hole diameters.
- Bends, flanges and sheet thickness are not inferred from STL.
