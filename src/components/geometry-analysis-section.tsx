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
import type { StlDetectedHole, StlGeometryAnalysis } from "@/lib/types";

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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="X" value={formatNumber(analysis.dimensions?.x)} unit={unit} />
        <MetricCard label="Y" value={formatNumber(analysis.dimensions?.y)} unit={unit} />
        <MetricCard label="Z" value={formatNumber(analysis.dimensions?.z)} unit={unit} />
        <MetricCard label="Volume" value={formatNumber(calculated.volumeCm3)} unit="cm3" />
        <MetricCard label="Area" value={formatNumber(calculated.area)} unit={`${unit}2`} />
        <MetricCard
          label="Triangoli"
          value={formatInteger(analysis.triangle_count)}
          unit="facce"
        />
        <MetricCard
          label="Peso stimato"
          value={formatNumber(calculated.weight.grams)}
          unit={`g / ${formatNumber(calculated.weight.kilograms)} kg`}
          emphasized
        />
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        STL non contiene unita native: la select interpreta le coordinate del file.
        {saveState === "saving" ? " Salvataggio..." : null}
        {saveState === "saved" ? " Valori salvati." : null}
        {saveState === "error" ? " Errore durante il salvataggio." : null}
      </p>

      <DetectedHoles holes={analysis.holes_detected ?? []} unit={unit} />
    </div>
  );
}

function DetectedHoles({ holes, unit }: { holes?: StlDetectedHole[]; unit: StlUnit }) {
  const safeHoles = holes ?? [];

  return (
    <section className="mt-5 border-t border-[var(--line)] pt-4">
      <div className="mb-3 flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
        <div>
          <h3 className="font-semibold">Fori rilevati</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Stima automatica da bordi aperti STL: verificare con CAD/metrologia.
          </p>
        </div>
        {safeHoles.length > 0 ? (
          <span className="text-xs font-semibold text-[var(--accent-strong)]">
            {safeHoles.length} rilevati
          </span>
        ) : null}
      </div>

      {safeHoles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--line)] bg-white p-3 text-sm text-[var(--muted)]">
          Nessun foro rilevato automaticamente.
        </p>
      ) : (
        <div className="grid gap-3">
          {safeHoles.map((hole, index) => (
            <div
              key={`${hole.center.x}-${hole.center.y}-${hole.center.z}-${index}`}
              className="rounded-lg border border-[var(--line)] bg-white p-3"
            >
              <div className="grid gap-3 text-sm md:grid-cols-[1fr_1.4fr_1fr_0.8fr]">
                <HoleMetric
                  label="Diametro"
                  value={formatNumber(hole.diameter_estimated)}
                  unit={unit}
                />
                <HoleMetric label="Centro X/Y/Z" value={formatVector(hole.center)} unit={unit} />
                <HoleMetric label="Asse stimato" value={formatAxis(hole.axis)} unit="" />
                <HoleMetric label="Confidenza" value={confidenceLabel(hole.confidence)} unit="" />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HoleMetric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold">
        {value}
        {unit ? <span className="ml-1 font-sans text-xs text-[var(--muted)]">{unit}</span> : null}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  emphasized = false,
}: {
  label: string;
  value: string;
  unit: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-lg border p-4",
        emphasized
          ? "border-[var(--accent)] bg-[#e2eee8]"
          : "border-[var(--line)] bg-white",
      ].join(" ")}
    >
      <p className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-2xl font-semibold leading-none text-[var(--foreground)]">
          {value}
        </span>
        <span className="text-sm font-medium text-[var(--muted)]">{unit}</span>
      </div>
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

function formatVector(vector: StlDetectedHole["center"]) {
  return `${formatNumber(vector.x)} / ${formatNumber(vector.y)} / ${formatNumber(vector.z)}`;
}

function formatAxis(axis: StlDetectedHole["axis"]) {
  if (!axis) {
    return "n/d";
  }

  return `${formatNumber(axis.x)} / ${formatNumber(axis.y)} / ${formatNumber(axis.z)}`;
}

function confidenceLabel(confidence: StlDetectedHole["confidence"]) {
  if (confidence === "high") {
    return "Alta";
  }

  if (confidence === "medium") {
    return "Media";
  }

  return "Bassa";
}
