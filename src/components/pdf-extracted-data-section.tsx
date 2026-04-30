import type { ComponentFile, PdfExtractedData, PdfExtractedFeatureGroup } from "@/lib/types";

export function PdfExtractedDataSection({ files }: { files: ComponentFile[] }) {
  const pdfFiles = files.filter((file) => file.extracted_pdf_data);

  if (!pdfFiles.length) {
    return null;
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-4 text-lg font-semibold">Dati estratti dal PDF</h2>
      <div className="space-y-4">
        {pdfFiles.map((file) => (
          <PdfExtractedDataCard
            key={file.id}
            fileName={file.file_name}
            data={file.extracted_pdf_data as PdfExtractedData}
          />
        ))}
      </div>
    </section>
  );
}

function PdfExtractedDataCard({
  fileName,
  data,
}: {
  fileName: string;
  data: PdfExtractedData;
}) {
  return (
    <article className="rounded-lg border border-[var(--line)] bg-[#faf9f5] p-4">
      <div className="mb-4">
        <h3 className="break-all text-sm font-semibold">{fileName}</h3>
        {data.warnings.length ? (
          <p className="mt-1 text-xs leading-5 text-amber-700">
            Warning: {data.warnings.join(" ")}
          </p>
        ) : null}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Field label="Nome pezzo" value={data.part_name} />
        <Field label="Materiale" value={data.material} />
        <Field label="Spessore" value={formatNumber(data.thickness_mm, "mm")} />
        <Field label="Peso pezzo" value={formatNumber(data.part_weight_kg, "kg")} />
        <Field label="Dimensioni" value={formatDimensions(data.dimensions_mm)} />
        <Field label="Blank size" value={formatDimensions(data.blank_size_mm)} />
        <Field label="Peso blank" value={formatNumber(data.blank_weight_kg, "kg")} />
        <Field label="Perimetro blank" value={formatNumber(data.blank_perimeter_mm, "mm")} />
        <Field label="Fori circolari" value={formatGroups(data.features.circular_holes, "diameter_mm")} />
        <Field label="Fori asolati" value={formatGroups(data.features.elongated_holes, "length_mm")} />
        <Field label="Fori poligonali" value={formatGroups(data.features.polygonal_holes, "size_mm")} />
        <Field label="Flange/pieghe" value={formatGroups(data.features.flanges, "length_mm")} />
      </dl>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase text-[var(--muted)]">
          Processo produttivo
        </p>
        <p className="mt-1 text-sm text-[var(--ink)]">
          {data.process_steps.length ? data.process_steps.join(", ") : "n/d"}
        </p>
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--ink)]">{value || "n/d"}</dd>
    </div>
  );
}

function formatNumber(value: number | null, unit: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }

  return `${Number(value.toFixed(4))} ${unit}`;
}

function formatDimensions(dimensions: Record<string, number | null>) {
  const values = Object.values(dimensions);

  if (values.some((value) => value === null)) {
    return "n/d";
  }

  return `${values.map((value) => Number((value as number).toFixed(4))).join(" x ")} mm`;
}

function formatGroups(
  groups: PdfExtractedFeatureGroup[],
  metric: "diameter_mm" | "length_mm" | "size_mm",
) {
  if (!groups.length) {
    return "n/d";
  }

  return groups
    .map((group) => {
      const value = group[metric];
      const metricLabel = value === null || value === undefined ? "" : ` da ${value} mm`;
      return `${group.count}${metricLabel}`;
    })
    .join(", ");
}
