# REVERSEPARTS MVP

Web app Next.js per caricare foto, PDF e note tecniche di un componente meccanico e generare una scheda tecnica preliminare tramite AI.

## Funzioni incluse

- Login e registrazione con Supabase Auth
- Dashboard componenti/progetti
- Creazione nuovo componente
- Upload immagini, PDF e file CAD/3D su Supabase Storage privato
- Campo note tecniche
- Generazione scheda AI con OpenAI Responses API
- Separazione obbligatoria tra dati certi, ipotesi e dati mancanti
- Domande da fare al cliente quando le informazioni non bastano
- Salvataggio report AI in database
- Pagina dettaglio componente

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth, Postgres e Storage
- OpenAI API
- Pronto per deploy su Vercel

## Setup locale

1. Installa le dipendenze:

```bash
npm install
```

2. Copia le variabili ambiente:

```bash
cp .env.example .env.local
```

3. Compila `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

4. In Supabase SQL Editor esegui:

```sql
-- vedi supabase/schema.sql
```

5. Avvia l'app:

```bash
npm run dev
```

Apri `http://localhost:3000`.

## Supabase

Lo schema si trova in `supabase/schema.sql` e crea:

- `components`
- `component_files`
- `ai_reports`
- bucket privato `component-files`
- policy RLS per isolare i dati per utente

Per un MVP locale puoi disabilitare la conferma email in Supabase Auth oppure configurare il redirect verso `http://localhost:3000/dashboard`.

## Regole AI implementate

Il prompt di sistema in `src/lib/ai/report-schema.ts` impone che il modello:

- non inventi quote, materiali, tolleranze o trattamenti
- metta le deduzioni in `assumptions`
- metta dati non verificabili in `missing_data`
- generi `customer_questions`
- includa sempre `confidence_level` e `confidence_reason`
- risponda solo in JSON validato da schema

I PDF e le immagini vengono letti dal bucket Supabase, convertiti in base64 e inviati alla Responses API. I file CAD/3D (`.stl`, `.step`, `.stp`, `.iges`, `.igs`, `.x_t`, `.x_b`, `.obj`, `.3mf`, `.dxf`, `.dwg`) vengono caricati, salvati e mostrati come documentazione tecnica, ma in questa versione non vengono parsati ne' inviati all'AI come contenuto tecnico. I file restano privati nello storage.

## Deploy Vercel

1. Importa la repository su Vercel.
2. Aggiungi le variabili ambiente del file `.env.example`.
3. Esegui lo schema SQL su Supabase.
4. Verifica in Supabase Auth che il redirect production punti al dominio Vercel.
5. Deploy.

## Nota di prodotto

La scheda generata e' preliminare: non sostituisce rilievi dimensionali, prove materiali, analisi FEM, controlli metrologici o validazioni di produzione.
