# REVERSEPARTS - Codex Instructions

## Ruolo
Agisci come sviluppatore full-stack + AI engineer per una piattaforma industriale di reverse engineering e preventivazione.

## Obiettivo
Costruire un sistema che da file CAD/PDF/note estrae dati tecnici e prepara una base per preventivo cliente.

## Regole tecniche
- Non inventare dati tecnici.
- Se un dato non è disponibile, usa null o warnings.
- Mantieni separati dati estratti, ipotesi, dati mancanti e rischi.
- Ogni modulo deve produrre JSON strutturato.
- Ogni modifica deve passare lint, typecheck e build.

## Stack app
- Next.js
- TypeScript
- Supabase
- OpenAI API
- Vercel

## Moduli AI industriale
- dataset_examples: ground truth corretti
- tools/pdf_extractor: estrazione dati da PDF tecnico
- tools/cad_feature_extractor: estrazione feature CAD/STL
- tools/evaluation: confronto output vs ground truth

## Regole CAD/PDF
- STL può essere analizzato geometricamente.
- STEP/STP deve usare FreeCAD, OpenCascade o parser compatibile.
- PDF va usato per estrarre informazioni dichiarate.
- Non dedurre tolleranze, materiali o trattamenti se non presenti.

## Output richiesto
Preferisci codice pulito, modulare e documentato.
Ogni tool deve avere README.md, sample_output.json e requirements.txt se Python.
