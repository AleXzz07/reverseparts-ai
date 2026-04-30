import { notFound, redirect } from "next/navigation";
import { Box, File, FileImage } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BackLink } from "@/components/back-link";
import { GenerateReportButton } from "@/components/generate-report-button";
import { GeometryAnalysisSection } from "@/components/geometry-analysis-section";
import { PdfExtractedDataSection } from "@/components/pdf-extracted-data-section";
import { ReportSection } from "@/components/report-section";
import { normalizeTechnicalReport } from "@/lib/ai/normalize-report";
import { isStlFile, isTechnicalDocument } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import type {
  AiReportRow,
  ComponentFile,
  ComponentProject,
  StlGeometryAnalysis,
} from "@/lib/types";

export default async function ComponentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: component } = await supabase
    .from("components")
    .select("*")
    .eq("id", id)
    .single();

  if (!component) {
    notFound();
  }

  const [{ data: files }, { data: reports }, { data: geometryAnalyses }] = await Promise.all([
    supabase.from("component_files").select("*").eq("component_id", id).order("created_at"),
    supabase
      .from("ai_reports")
      .select("*")
      .eq("component_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("stl_geometry_analyses")
      .select("*")
      .eq("component_id", id)
      .order("created_at"),
  ]);

  const latestReport = reports?.[0] as AiReportRow | undefined;
  const report = normalizeTechnicalReport(latestReport?.report);
  const geometryRows = (geometryAnalyses as StlGeometryAnalysis[]) ?? [];
  const fileRows = (files as ComponentFile[]) ?? [];
  const geometryByFileId = new Map(
    geometryRows.map((analysis) => [analysis.component_file_id, analysis]),
  );

  return (
    <AppShell>
      <BackLink />
      <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-start">
        <div>
          <p className="mb-2 font-mono text-xs uppercase text-[var(--accent)]">
            Dettaglio componente
          </p>
          <h1 className="text-3xl font-semibold">{(component as ComponentProject).title}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Stato: {(component as ComponentProject).status === "generated" ? "scheda AI generata" : "bozza"}
          </p>
        </div>
        <GenerateReportButton componentId={id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="space-y-6">
          <section className="panel p-5">
            <h2 className="mb-4 text-lg font-semibold">Note tecniche</h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
              {(component as ComponentProject).notes || "Nessuna nota inserita."}
            </p>
          </section>

          <section className="panel p-5">
            <h2 className="mb-4 text-lg font-semibold">Documentazione tecnica</h2>
            {fileRows.length > 0 ? (
              <ul className="space-y-3">
                {fileRows.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-[#faf9f5] p-3 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                    {(file.file_type ?? "").startsWith("image/") ? (
                      <FileImage aria-hidden size={18} className="text-[var(--accent)]" />
                    ) : isTechnicalDocument(file.file_name) ? (
                      <Box aria-hidden size={18} className="text-[var(--accent)]" />
                    ) : (
                      <File aria-hidden size={18} className="text-[var(--accent)]" />
                    )}
                    <span className="break-all">{file.file_name}</span>
                    </span>
                    {isStlFile(file.file_name) && geometryByFileId.get(file.id)?.status === "failed" ? (
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                        STL errore
                      </span>
                    ) : isStlFile(file.file_name) && geometryByFileId.get(file.id)?.status === "success" ? (
                      <span className="shrink-0 rounded-full bg-[#e2eee8] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                        STL analizzato
                      </span>
                    ) : isTechnicalDocument(file.file_name) ? (
                      <span className="shrink-0 rounded-full bg-[#e2eee8] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                        CAD/3D
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">Nessun file caricato.</p>
            )}
          </section>
          <PdfExtractedDataSection files={fileRows} />
          <GeometryAnalysisSection analyses={geometryRows} />
        </aside>

        <section className="panel p-5">
          <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-semibold">Scheda tecnica preliminare</h2>
              {latestReport ? (
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Modello: {latestReport.model}
                </p>
              ) : null}
            </div>
            {report ? (
              <span className="rounded-full bg-[#e2eee8] px-3 py-1 text-sm font-semibold text-[var(--accent-strong)]">
                Confidenza: {report.confidence_level}
              </span>
            ) : null}
          </div>

          {report ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-[var(--line)] bg-[#faf9f5] p-4">
                <h3 className="font-semibold">{report.component_name}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {report.confidence_reason}
                </p>
              </div>
              <ReportSection title="Dati rilevati" items={report.detected_data} />
              <ReportSection title="Ipotesi tecniche" items={report.technical_assumptions} tone="warning" />
              <ReportSection title="Dati mancanti" items={report.missing_data} tone="warning" />
              <ReportSection title="Criticita'" items={report.risks} tone="danger" />
              <ReportSection title="Prossime verifiche" items={report.next_checks} />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--line)] p-8 text-center">
              <h3 className="text-lg font-semibold">Scheda non ancora generata</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
                Usa il bottone di generazione per inviare note e file all&apos;AI.
                L&apos;output separera&apos; dati certi, ipotesi, dati mancanti e domande
                da porre al cliente.
              </p>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
