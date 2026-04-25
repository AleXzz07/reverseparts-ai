# REVERSEPARTS MVP

Web app Next.js per caricare foto, PDF e note tecniche di un componente meccanico e generare una scheda tecnica preliminare tramite AI.

## Funzioni incluse

- Login e registrazione con Supabase Auth
- Recupero password con email Supabase Auth
- Dashboard componenti/progetti
- Cartelle per organizzare i componenti
- Creazione nuovo componente
- Eliminazione componenti con rimozione file Storage e report AI collegati
- Upload immagini, PDF e file CAD/3D su Supabase Storage privato
- Analisi geometrica server-side per file STL
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
- `folders`
- `component_files`
- `stl_geometry_analyses`
- `ai_reports`
- bucket privato `component-files`
- policy RLS per isolare i dati per utente

Per un MVP locale puoi disabilitare la conferma email in Supabase Auth oppure configurare il redirect verso `http://localhost:3000/dashboard`.

### Redirect Auth

In Supabase Auth configura gli URL consentiti:

- `http://localhost:3000/dashboard`
- `http://localhost:3000/update-password`
- dominio Vercel production, per esempio `https://tuo-progetto.vercel.app/dashboard`
- dominio Vercel production per reset password, per esempio `https://tuo-progetto.vercel.app/update-password`

Il reset password usa `resetPasswordForEmail` con redirect verso `/update-password`, poi `updateUser` per salvare la nuova password.

## Regole AI implementate

Il prompt di sistema in `src/lib/ai/report-schema.ts` impone che il modello produca una scheda concisa:

- non inventi quote, materiali, tolleranze o trattamenti
- metta le deduzioni in `technical_assumptions`
- metta dati non verificabili in `missing_data`
- generi prossime verifiche in `next_checks`
- usi al massimo 5 punti brevi per sezione
- includa sempre `confidence_level` e `confidence_reason`
- risponda solo in JSON validato da schema

I PDF e le immagini vengono letti dal bucket Supabase, convertiti in base64 e inviati alla Responses API.

I file STL vengono analizzati lato server con un parser interno compatibile con STL binario e ASCII base. L'analisi salva bounding box, dimensioni X/Y/Z, volume stimato, area superficiale, numero triangoli/facce e unita' scelta dall'utente. Nota: STL non contiene unita' nativa; di default l'app interpreta le coordinate come `mm`.

Nella pagina dettaglio puoi scegliere l'unita' STL (`mm`, `cm`, `m`, `inch`) e una densita' materiale. Sono inclusi preset rapidi:

- Alluminio: 2.70 g/cm3
- Acciaio: 7.85 g/cm3
- Titanio: 4.50 g/cm3
- Plastica ABS: 1.04 g/cm3
- Personalizzato

L'app salva densita', volume in cm3 e peso stimato in grammi/kg, che vengono passati al prompt AI come dati geometrici rilevati.

Gli altri file CAD/3D (`.step`, `.stp`, `.iges`, `.igs`, `.x_t`, `.x_b`, `.obj`, `.3mf`, `.dxf`, `.dwg`) vengono caricati, salvati e mostrati come documentazione tecnica, ma in questa versione non vengono parsati ne' inviati all'AI come contenuto tecnico. I file restano privati nello storage.

## Deploy Vercel

1. Importa la repository su Vercel.
2. Aggiungi le variabili ambiente del file `.env.example`.
3. Esegui lo schema SQL su Supabase.
4. Verifica in Supabase Auth che il redirect production punti al dominio Vercel.
5. Deploy.

## Nota di prodotto

La scheda generata e' preliminare: non sostituisce rilievi dimensionali, prove materiali, analisi FEM, controlli metrologici o validazioni di produzione.
