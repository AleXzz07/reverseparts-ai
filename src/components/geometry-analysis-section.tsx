import type { StlGeometryAnalysis } from "@/lib/types";

export function GeometryAnalysisSection({
  analyses,
}: {
  analyses: StlGeometryAnalysis[];
}) {
  if (!analyses.length) {
    return null;
  }

  return (
    <section className="panel p-5">
      <h2 className="mb-4 text-lg font-semibold">Analisi geometrica</h2>
      <div className="space-y-4">
        {analyses.map((analysis) => (
          <div key={analysis.id} className="rounded-lg border border-[var(--line)] bg-[#faf9f5] p-4">
            {analysis.status === "failed" ? (
              <div>
                <p className="font-semibold text-[var(--danger)]">STL non analizzabile</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {analysis.error_message ?? "Errore non specificato durante l'analisi STL."}
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex flex-col justify-between gap-2 md:flex-row md:items-center">
                  <p className="font-semibold">Risultati STL</p>
                  <span className="rounded-full bg-[#e2eee8] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                    {analysis.presumed_unit}
                  </span>
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <Metric label="Dimensione X" value={formatNumber(analysis.dimensions?.x)} />
                  <Metric label="Dimensione Y" value={formatNumber(analysis.dimensions?.y)} />
                  <Metric label="Dimensione Z" value={formatNumber(analysis.dimensions?.z)} />
                  <Metric label="Volume stimato" value={formatNumber(analysis.volume_estimated)} />
                  <Metric label="Area superficiale" value={formatNumber(analysis.surface_area)} />
                  <Metric label="Triangoli/facce" value={formatInteger(analysis.triangle_count)} />
                </dl>
                {analysis.bounding_box ? (
                  <p className="mt-4 font-mono text-xs leading-5 text-[var(--muted)]">
                    Bounding box min [{formatNumber(analysis.bounding_box.min.x)},{" "}
                    {formatNumber(analysis.bounding_box.min.y)},{" "}
                    {formatNumber(analysis.bounding_box.min.z)}] max [
                    {formatNumber(analysis.bounding_box.max.x)},{" "}
                    {formatNumber(analysis.bounding_box.max.y)},{" "}
                    {formatNumber(analysis.bounding_box.max.z)}]
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-mono font-semibold">{value}</dd>
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
