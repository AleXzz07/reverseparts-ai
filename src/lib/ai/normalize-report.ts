import type { TechnicalReport } from "@/lib/types";

type LegacyTechnicalReport = Partial<TechnicalReport> & {
  confirmed_data?: string[];
  assumptions?: string[];
  customer_questions?: string[];
  suggested_processes?: string[];
};

export function normalizeTechnicalReport(report: unknown): TechnicalReport | null {
  if (!report || typeof report !== "object") {
    return null;
  }

  const raw = report as LegacyTechnicalReport;

  return {
    component_name: stringOrFallback(raw.component_name, "Componente non identificato"),
    detected_data: limitedList(raw.detected_data ?? raw.confirmed_data),
    technical_assumptions: limitedList(raw.technical_assumptions ?? raw.assumptions),
    missing_data: limitedList(raw.missing_data),
    risks: limitedList(raw.risks),
    next_checks: limitedList(raw.next_checks ?? raw.customer_questions ?? raw.suggested_processes),
    confidence_level: normalizeConfidence(raw.confidence_level),
    confidence_reason: stringOrFallback(raw.confidence_reason, "Confidenza non specificata."),
  };
}

function limitedList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 5);
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function normalizeConfidence(value: unknown): TechnicalReport["confidence_level"] {
  return value === "low" || value === "medium" || value === "high" ? value : "low";
}
