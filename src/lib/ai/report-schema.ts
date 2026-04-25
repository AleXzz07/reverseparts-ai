import { z } from "zod";

export const technicalReportSchema = z.object({
  component_name: z.string().min(1),
  detected_data: z.array(z.string()).max(5),
  technical_assumptions: z.array(z.string()).max(5),
  missing_data: z.array(z.string()),
  risks: z.array(z.string()),
  next_checks: z.array(z.string()).max(5),
  confidence_level: z.enum(["low", "medium", "high"]),
  confidence_reason: z.string().max(180),
});

export const jsonSchema = {
  name: "reverseparts_technical_report",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "component_name",
      "detected_data",
      "technical_assumptions",
      "missing_data",
      "risks",
      "next_checks",
      "confidence_level",
      "confidence_reason",
    ],
    properties: {
      component_name: { type: "string" },
      detected_data: { type: "array", maxItems: 5, items: { type: "string" } },
      technical_assumptions: { type: "array", maxItems: 5, items: { type: "string" } },
      missing_data: { type: "array", maxItems: 5, items: { type: "string" } },
      risks: { type: "array", maxItems: 5, items: { type: "string" } },
      next_checks: { type: "array", maxItems: 5, items: { type: "string" } },
      confidence_level: { type: "string", enum: ["low", "medium", "high"] },
      confidence_reason: { type: "string" },
    },
  },
  strict: true,
} as const;

export const reportSystemPrompt = `
Sei un assistente tecnico per reverse engineering preliminare di componenti meccanici.

Regole non negoziabili:
- Non inventare dati tecnici, quote, materiali, trattamenti o tolleranze.
- Output conciso, tecnico, a punti brevi. Niente introduzioni, frasi generiche o spiegazioni lunghe.
- Usa solo queste sezioni: detected_data, technical_assumptions, missing_data, risks, next_checks.
- Massimo 5 punti per sezione. Ogni punto massimo 120 caratteri.
- Se un dato non e' visibile o deducibile con alta sicurezza, mettilo in missing_data o next_checks.
- Se fai una deduzione, deve stare in technical_assumptions, non in detected_data.
- Includi sempre confidence_level e confidence_reason.
- Se sono presenti peso, volume e dimensioni STL calcolati lato server, usali nei detected_data.
- Se sono presenti fori rilevati da STL, includili solo come stime nei detected_data o next_checks e specifica che vanno verificati con CAD/metrologia.
- Non inventare trattamenti, lavorazioni o materiali non indicati.
- Non usare file STEP, IGES, Parasolid, OBJ, 3MF, DXF o DWG come fonte geometrica finche' non esiste una loro analisi esplicita.
- Rispondi solo con JSON valido conforme allo schema.
`.trim();
