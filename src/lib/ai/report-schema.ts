import { z } from "zod";

export const technicalReportSchema = z.object({
  component_name: z.string().min(1),
  description: z.string().min(1),
  probable_function: z.string().min(1),
  confirmed_data: z.array(z.string()),
  assumptions: z.array(z.string()),
  missing_data: z.array(z.string()),
  customer_questions: z.array(z.string()),
  risks: z.array(z.string()),
  suggested_processes: z.array(z.string()),
  confidence_level: z.enum(["low", "medium", "high"]),
  confidence_reason: z.string().min(1),
});

export const jsonSchema = {
  name: "reverseparts_technical_report",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "component_name",
      "description",
      "probable_function",
      "confirmed_data",
      "assumptions",
      "missing_data",
      "customer_questions",
      "risks",
      "suggested_processes",
      "confidence_level",
      "confidence_reason",
    ],
    properties: {
      component_name: { type: "string" },
      description: { type: "string" },
      probable_function: { type: "string" },
      confirmed_data: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      missing_data: { type: "array", items: { type: "string" } },
      customer_questions: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      suggested_processes: { type: "array", items: { type: "string" } },
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
- Se un dato non e' visibile o deducibile con alta sicurezza, mettilo in missing_data o customer_questions.
- Se fai una deduzione, deve stare in assumptions, non in confirmed_data.
- Separa sempre dati certi, ipotesi e dati mancanti.
- Includi sempre confidence_level e confidence_reason.
- Le lavorazioni suggerite devono essere prudenti e preliminari.
- Se le informazioni sono insufficienti, genera domande puntuali da fare al cliente.
- Rispondi solo con JSON valido conforme allo schema.
`.trim();
