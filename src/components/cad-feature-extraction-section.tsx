import type { CadFeatureData, CadFeatureExtraction, CadFeatureGroup, ComponentFile } from "@/lib/types";

export function CadFeatureExtractionSection({
  extractions,
  filesById,
}: {
  extractions: CadFeatureExtraction[];
  filesById: Map<string, ComponentFile>;
}) {
  if (!extractions.length) {
    return null;
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-4 text-lg font-semibold">Dati estratti dal CAD</h2>
      <div className="space-y-4">
        {extractions.map((extraction) => (
          <CadExtractionCard
            key={extraction.id}
            extraction={extraction}
            fileName={filesById.get(extraction.component_file_id)?.file_name ?? "File CAD"}
          />
        ))}
      </div>
    </section>
  );
}

function CadExtractionCard({
  extraction,
  fileName,
}: {
  extraction: CadFeatureExtraction;
  fileName: string;
}) {
  if (extraction.status === "failed") {
    return (
      <article className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <h3 className="break-all font-semibold">{fileName}</h3>
        <p className="mt-2">{extraction.error_message ?? "Estrazione CAD fallita."}</p>
      </article>
    );
  }

  const data = extraction.extracted_data;

  if (!data) {
    return null;
  }

  const canUseStepHoleDetection = data.holes_detection_confidence === "high";
  const holeStatus = canUseStepHoleDetection
    ? formatMaybeNumber(data.holes_count)
    : "rilevamento non affidabile";

  return (
    <article className="rounded-lg border border-[var(--line)] bg-[#faf9f5] p-4">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="break-all text-sm font-semibold">{fileName}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Fonte primaria: {data.file_type || "CAD"}
          </p>
        </div>
        <span className="w-fit rounded-full bg-[#e2eee8] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
          Complessita&apos;: {data.complexity_score}
        </span>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Dimensioni X/Y/Z" value={formatDimensions(data.dimensions_mm)} />
        <Field label="Volume" value={formatNumber(data.volume_cm3, "cm3")} />
        <Field label="Area" value={formatNumber(data.surface_area_cm2, "cm2")} />
        <Field label="Peso stimato" value={formatNumber(data.estimated_weight_kg, "kg")} />
        <Field label="Spessore lamiera" value={formatNumber(data.thickness_mm, "mm")} />
        <Field label="Fori" value={holeStatus} />
        <Field label="Confidenza fori" value={data.holes_detection_confidence ?? "n/d"} />
        <Field label="Candidati debug" value={formatMaybeNumber(data.holes_debug_candidates_count ?? null)} />
        {canUseStepHoleDetection ? (
          <>
            <Field label="Fori circolari" value={formatGroups(data.features?.circular_holes ?? [], "diameter_mm")} />
            <Field label="Fori asolati" value={formatGroups(data.features?.elongated_holes ?? [], "length_mm")} />
            <Field label="Fori poligonali" value={formatGroups(data.features?.polygonal_holes ?? [], "size_mm")} />
          </>
        ) : null}
        <Field label="Flange/pieghe" value={formatGroups(data.features?.flanges ?? data.flanges, "length_mm")} />
      </dl>

      {!canUseStepHoleDetection ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          Rilevamento fori STEP in sviluppo: usare PDF/CAD tecnico per conferma.
        </div>
      ) : null}

      {data.warnings.length ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          {data.warnings.join(" ")}
        </div>
      ) : null}
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function formatDimensions(dimensions: CadFeatureData["dimensions_mm"]) {
  const values = [dimensions.x, dimensions.y, dimensions.z];

  if (values.some((value) => value === null)) {
    return "n/d";
  }

  return `${values.map((value) => formatRawNumber(value)).join(" x ")} mm`;
}

function formatNumber(value: number | null, unit: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }

  return `${formatRawNumber(value)} ${unit}`;
}

function formatMaybeNumber(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }

  return formatRawNumber(value);
}

function formatRawNumber(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }

  return Number(value.toFixed(4)).toString();
}

function formatGroups(
  groups: CadFeatureGroup[],
  metric: "diameter_mm" | "length_mm" | "size_mm",
) {
  if (!groups.length) {
    return "n/d";
  }

  return groups
    .slice(0, 3)
    .map((group) => {
      const count = group.count ?? 1;
      const value = group[metric];
      const metricLabel = typeof value === "number" ? ` da ${formatRawNumber(value)} mm` : "";
      return `${count}${metricLabel}`;
    })
    .join(", ");
}
