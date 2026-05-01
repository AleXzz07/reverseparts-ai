# REVERSEPARTS CAD Analysis API

Backend Python separato per analizzare file STP/STEP con FreeCAD o OpenCascade e restituire JSON tecnico all'app Next.js tramite `CAD_ANALYSIS_API_URL`.

## Endpoint

`POST /analyze-cad`

Input `multipart/form-data`:

- `file`: file `.stp` o `.step`
- `materiale`: opzionale
- `density_g_cm3`: opzionale
- `unit`: opzionale, uno tra `mm`, `cm`, `m`, `inch`
- `notes`: opzionale, usato anche per estrarre densita' testuali come `densita 2.70 g/cm3`

## Output

Restituisce JSON con dimensioni, volume, area, peso stimato, fori, flange/pieghe, spessore se deducibile, complessita' e warnings.

Se FreeCAD/OpenCascade non sono disponibili, risponde `503` con errore JSON chiaro e campi tecnici `null`/vuoti.

## Avvio locale

```bash
cd cad-analysis-api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

FreeCAD non e' installabile via `pip`: installalo nel sistema o usa il Dockerfile.

## Docker

```bash
docker build -t reverseparts-cad-analysis .
docker run -p 8000:8000 reverseparts-cad-analysis
```

Il Dockerfile usa `ubuntu:22.04` e installa:

- `freecad`
- `freecad-python3`
- `python3-pivy`
- `opencascade-tools` se disponibile nel repository apt

Imposta inoltre:

```bash
FREECAD_PYTHON_PATH=/usr/lib/freecad/lib
PYTHONPATH=/usr/lib/freecad/lib:/usr/lib/freecad/Ext:/usr/lib/python3/dist-packages
```

Durante la build esegue un controllo `import FreeCAD, Part`; se fallisce, la build fallisce invece di arrivare su Render con un container non funzionante.

Configura poi l'app Next.js:

```bash
CAD_ANALYSIS_API_URL=https://tuo-backend.example.com/analyze-cad
```

## Deploy

### Render

1. Crea un nuovo Web Service da repository.
2. Usa Docker come environment.
3. Root directory: `cad-analysis-api`.
4. Health check: `/health`.
5. Lascia che Render usi il `Dockerfile` della cartella.
6. Imposta l'URL pubblico in `CAD_ANALYSIS_API_URL` nell'app Vercel, per esempio `https://reverseparts-cad.onrender.com/analyze-cad`.

Se Render mostra ancora `FreeCAD/OpenCascade non disponibile`, controlla i log di build: il Dockerfile deve stampare `FreeCAD import OK`. Se non appare, il container non sta usando questo Dockerfile o l'immagine e' stata buildata da una root directory errata.

### Railway

1. Crea un nuovo servizio dal repo.
2. Seleziona Dockerfile.
3. Root directory: `cad-analysis-api`.
4. Espone porta `8000`.
5. Usa `/analyze-cad` come endpoint per `CAD_ANALYSIS_API_URL`.

### Fly.io

1. Da `cad-analysis-api`, esegui `fly launch`.
2. Conferma Dockerfile esistente.
3. Imposta porta interna `8000`.
4. Deploy con `fly deploy`.
5. Usa `https://<app>.fly.dev/analyze-cad` come `CAD_ANALYSIS_API_URL`.

## Regole

- Non inventa dati tecnici.
- Feature non deducibili restano `null`, `[]` o nei `warnings`.
- STP/STEP e' la fonte tecnica primaria; PDF/expected output restano ground truth di confronto.

## Debug STAFFA TEST 1-1

Per confrontare un output CAD locale con la ground truth:

```bash
python debug_staffa_test.py path/to/cad_output.json
```

Il report mostra delta dimensioni, errore su spessore/peso e differenze nei conteggi fori/flange. Non forza mai valori del PDF nel risultato CAD.
