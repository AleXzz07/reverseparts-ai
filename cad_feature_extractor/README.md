# cad_feature_extractor

Modulo Python separato per leggere file CAD/3D e produrre un JSON tecnico con feature geometriche.

## Supporto iniziale

- STL tramite `trimesh`
- STEP, STP, IGES e IGS sono riconosciuti come formati futuri, con placeholder per integrazione FreeCAD/OpenCascade

Il modulo non e collegato all'app Next.js.

## Installazione

Da questa cartella:

```bash
cd cad_feature_extractor
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Oppure, dalla root del progetto:

```bash
python -m venv cad_feature_extractor\.venv
cad_feature_extractor\.venv\Scripts\activate
pip install -r cad_feature_extractor\requirements.txt
```

## Uso da terminale

Stampare il JSON in console:

```bash
python -m cad_feature_extractor path\to\part.stl --pretty
```

Salvare il JSON su file:

```bash
python -m cad_feature_extractor path\to\part.stl --pretty -o output\features.json
```

Impostare la densita del materiale per stimare il peso:

```bash
python -m cad_feature_extractor path\to\part.stl --density-g-cm3 2.7 --pretty
```

Esempi densita:

- ABS: `1.04`
- PLA: `1.24`
- Alluminio: `2.7`
- Acciaio: `7.85`

## Output JSON

```json
{
  "dimensions_mm": {"x": 0, "y": 0, "z": 0},
  "volume_cm3": 0,
  "surface_area_cm2": 0,
  "estimated_weight_kg": 0,
  "holes_count": 0,
  "holes": [],
  "bounding_box": {},
  "complexity_score": "low",
  "warnings": []
}
```

Per STL, le unita non sono memorizzate nel file: il modulo interpreta i valori come millimetri. Il conteggio fori e una stima topologica su mesh, non un riconoscimento parametrico CAD.

## Uso come libreria

```python
from cad_feature_extractor import extract_features

features = extract_features("path/to/part.stl", material_density_g_cm3=2.7)
print(features)
```

## Roadmap STEP/IGES

La futura integrazione FreeCAD/OpenCascade dovrebbe:

1. importare solidi B-Rep da STEP/STP/IGES/IGS;
2. calcolare bounding box, volume e area direttamente sul solido;
3. riconoscere feature parametriche come fori cilindrici, tasche, raccordi e smussi;
4. usare tessellazione solo come fallback per analisi mesh.
