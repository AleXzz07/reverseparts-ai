"use client";

import { useMemo, useState } from "react";
import {
  calculateWeight,
  convertAreaFromSquareMillimeters,
  convertVolumeToCm3,
  materialPresets,
  type StlUnit,
  unitOptions,
} from "@/lib/geometry-units";
import type { StlGeometryAnalysis } from "@/lib/types";

export function GeometryAnalysisSection({
  analyses,
}: {
  analyses?: StlGeometryAnalysis[];
}) {
  const safeAnalyses = analyses ?? [];

  if (safeAnalyses.length === 0) {
    return null;
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-4 text-lg font-semibold">Analisi geometrica</h2>
      <div className="space-y-4">
        {safeAnalyses.map((analysis) => (
          <GeometryAnalysisCard key={analysis.id} analysis={analysis} />
        ))}
      </div>
    </section>
  );
}

function GeometryAnalysisCard({ analysis }: { analysis: StlGeometryAnalysis }) {
  const [unit, setUnit] = useState<StlUnit>(analysis.selected_unit ?? "mm");
  const [material, setMaterial] = useState(analysis.material_label ?? "");
  const [density, setDensity] = useState<number | null>(analysis.density_g_cm3 ?? null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const calculated = useMemo(() => {
    const volumeCm3 = convertVolumeToCm3(analysis.volume_estimated, unit);
    const area = convertAreaFromSquareMillimeters(analysis.surface_area, unit);
    const weight = calculateWeight(volumeCm3, density);

    return { volumeCm3, area, weight };
  }, [analysis.surface_area, analysis.volume_estimated, density, unit]);

  if (analysis.status === "failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="font-semibold text-[var(--danger)]">STL non analizzabile</p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {analysis.error_message ?? "Errore non specificato durante l'analisi STL."}
        </p>
      </div>
    );
  }

  async function save(nextUnit = unit, nextMaterial = material, nextDensity = density) {
    setSaveState("saving");
    const response = await fetch(`/api/geometry/${analysis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selected_unit: nextUnit,
        material_label: nextMaterial || null,
        density_g_cm3: nextDensity,
      }),
    });

    setSaveState(response.ok ? "saved" : "error");
  }

  function selectMaterial(label: string) {
    const preset = materialPresets.find((item) => item.label === label);
    const nextDensity = preset?.density ?? null;

    setMaterial(label);
    setDensity(nextDensity);
    void save(unit, label, nextDensity);
  }

  function updateUnit(nextUnit: StlUnit) {
    setUnit(nextUnit);
    void save(nextUnit, material, density);
  }

  function updateDensity(value: string) {
    const nextDensity = value ? Number(value) : null;
    setDensity(nextDensity);
    void save(unit, material || "Personalizzato", nextDensity);
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[#faf9f5] p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Unita STL</span>
          <select
            className="field py-2"
            value={unit}
            onChange={(event) => updateUnit(event.target.value as StlUnit)}
          >
            {unitOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Materiale</span>
          <select
            className="field py-2"
            value={material}
            onChange={(event) => selectMaterial(event.target.value)}
          >
            <option value="">Non indicato</option>
            {materialPresets.map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Densita g/cm3</span>
          <input
            className="field py-2"
            type="number"
            min="0"
            step="0.01"
            value={density ?? ""}
            onChange={(event) => updateDensity(event.target.value)}
            placeholder="Es. 7.85"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs uppercase text-[var(--muted)]">
              <th className="py-2 pr-3">X</th>
              <th className="py-2 pr-3">Y</th>
              <th className="py-2 pr-3">Z</th>
              <th className="py-2 pr-3">Volume</th>
              <th className="py-2 pr-3">Area</th>
              <th className="py-2 pr-3">Triangoli</th>
              <th className="py-2 pr-3">Unita</th>
              <th className="py-2">Peso stimato</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-mono">
              <td className="py-3 pr-3">{formatNumber(analysis.dimensions?.x)}</td>
              <td className="py-3 pr-3">{formatNumber(analysis.dimensions?.y)}</td>
              <td className="py-3 pr-3">{formatNumber(analysis.dimensions?.z)}</td>
              <td className="py-3 pr-3">{formatNumber(calculated.volumeCm3)} cm3</td>
              <td className="py-3 pr-3">
                {formatNumber(calculated.area)} {unit}2
              </td>
              <td className="py-3 pr-3">{formatInteger(analysis.triangle_count)}</td>
              <td className="py-3 pr-3">{unit}</td>
              <td className="py-3">
                {formatNumber(calculated.weight.grams)} g /{" "}
                {formatNumber(calculated.weight.kilograms)} kg
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        STL non contiene unita native: la select interpreta le coordinate del file.
        {saveState === "saving" ? " Salvataggio..." : null}
        {saveState === "saved" ? " Valori salvati." : null}
        {saveState === "error" ? " Errore durante il salvataggio." : null}
      </p>
    </div>
  );
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }

  return new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: 3,
  }).format(value);
}

function formatInteger(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }

  return new Intl.NumberFormat("it-IT", {
    maximumFractionDigits: 0,
  }).format(value);
}
