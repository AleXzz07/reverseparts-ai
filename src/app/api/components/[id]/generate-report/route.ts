import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { reportSystemPrompt, jsonSchema, technicalReportSchema } from "@/lib/ai/report-schema";
import { aiReadableMimeTypes, isTechnicalDocument } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import type { ComponentFile, ComponentProject, StlGeometryAnalysis } from "@/lib/types";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY non configurata.");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function fileToContentPart(
  file: ComponentFile,
  data: Blob,
): Promise<ResponseInputContent | null> {
  if (!aiReadableMimeTypes.has(file.file_type)) {
    return null;
  }

  if (data.size > MAX_FILE_BYTES) {
    throw new Error(`Il file ${file.file_name} supera il limite di 50 MB.`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const base64 = buffer.toString("base64");

  if (file.file_type === "application/pdf") {
    return {
      type: "input_file",
      filename: file.file_name,
      file_data: `data:application/pdf;base64,${base64}`,
    };
  }

  return {
    type: "input_image",
    image_url: `data:${file.file_type};base64,${base64}`,
    detail: "high",
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato." }, { status: 401 });
    }

    const { data: component, error: componentError } = await supabase
      .from("components")
      .select("*")
      .eq("id", id)
      .single();

    if (componentError || !component) {
      return NextResponse.json({ error: "Componente non trovato." }, { status: 404 });
    }

    const { data: files, error: filesError } = await supabase
      .from("component_files")
      .select("*")
      .eq("component_id", id)
      .order("created_at");

    if (filesError) {
      return NextResponse.json({ error: filesError.message }, { status: 500 });
    }

    const { data: geometryAnalyses, error: geometryError } = await supabase
      .from("stl_geometry_analyses")
      .select("*")
      .eq("component_id", id)
      .order("created_at");

    if (geometryError) {
      return NextResponse.json({ error: geometryError.message }, { status: 500 });
    }

    const content: ResponseInputContent[] = [
      {
        type: "input_text",
        text: `
Analizza il componente meccanico caricato e genera una scheda tecnica preliminare.

Nome interno progetto: ${(component as ComponentProject).title}

Note tecniche dell'utente:
${(component as ComponentProject).notes || "Nessuna nota tecnica fornita."}

File allegati: ${(files as ComponentFile[] | null)?.map((file) => `${file.file_name} (${describeFileForPrompt(file)})`).join(", ") || "nessuno"}.

Dati geometrici STL calcolati lato server:
${formatGeometryForPrompt((geometryAnalyses as StlGeometryAnalysis[] | null) ?? [])}
`.trim(),
      },
    ];

    for (const file of (files as ComponentFile[] | null) ?? []) {
      if (!aiReadableMimeTypes.has(file.file_type)) {
        continue;
      }

      const { data, error } = await supabase.storage.from("component-files").download(file.file_path);

      if (error || !data) {
        return NextResponse.json(
          { error: `Impossibile leggere il file ${file.file_name}.` },
          { status: 500 },
        );
      }

      const part = await fileToContentPart(file, data);
      if (part) {
        content.push(part);
      }
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const openai = getOpenAI();
    const response = await openai.responses.create({
      model,
      instructions: reportSystemPrompt,
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...jsonSchema,
        },
      },
    });

    const parsed = technicalReportSchema.parse(JSON.parse(response.output_text));

    const { error: insertError } = await supabase.from("ai_reports").insert({
      component_id: id,
      user_id: user.id,
      report: parsed,
      model,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("components")
      .update({ status: "generated", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ report: parsed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore inatteso.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function describeFileForPrompt(file: ComponentFile) {
  if (file.file_name.toLowerCase().endsWith(".stl")) {
    return "file STL; usare l'analisi geometrica calcolata se presente";
  }

  if (isTechnicalDocument(file.file_name)) {
    return "documentazione CAD/3D non analizzata in questa versione";
  }

  return file.file_type;
}

function formatGeometryForPrompt(analyses: StlGeometryAnalysis[]) {
  if (!analyses.length) {
    return "Nessuna analisi geometrica STL disponibile.";
  }

  return analyses
    .map((analysis, index) => {
      if (analysis.status === "failed") {
        return `STL ${index + 1}: analisi fallita. Errore: ${
          analysis.error_message ?? "errore non specificato"
        }.`;
      }

      return [
        `STL ${index + 1}:`,
        `- bounding box min: ${formatVector(analysis.bounding_box?.min ?? null)}, max: ${formatVector(analysis.bounding_box?.max ?? null)}`,
        `- dimensioni X/Y/Z: ${formatVector(analysis.dimensions)}`,
        `- volume STL grezzo: ${formatNumber(analysis.volume_estimated)}`,
        `- volume calcolato: ${formatNumber(analysis.volume_cm3)} cm3`,
        `- area superficiale: ${formatNumber(analysis.surface_area)}`,
        `- densita': ${formatNumber(analysis.density_g_cm3)} g/cm3 (${analysis.material_label ?? "materiale non indicato"})`,
        `- peso stimato: ${formatNumber(analysis.estimated_weight_g)} g / ${formatNumber(analysis.estimated_weight_kg)} kg`,
        `- triangoli/facce: ${analysis.triangle_count ?? "n/d"}`,
        `- unita' STL scelta: ${analysis.selected_unit}`,
        `- fori rilevati stimati: ${formatHolesForPrompt(analysis.holes_detected ?? [], analysis.selected_unit)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function formatHolesForPrompt(
  holes: StlGeometryAnalysis["holes_detected"],
  unit: StlGeometryAnalysis["selected_unit"],
) {
  const safeHoles = holes ?? [];

  if (safeHoles.length === 0) {
    return "nessuno";
  }

  return safeHoles
    .slice(0, 8)
    .map(
      (hole, index) =>
        `foro ${index + 1}: diametro ${formatNumber(hole.diameter_estimated)} ${unit}, centro ${formatVector(hole.center)}, asse ${formatVector(hole.axis)}, confidenza ${hole.confidence}`,
    )
    .join("; ");
}

function formatVector(vector: StlGeometryAnalysis["dimensions"]) {
  if (!vector) {
    return "n/d";
  }

  return `${formatNumber(vector.x)} / ${formatNumber(vector.y)} / ${formatNumber(vector.z)}`;
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }

  return Number(value.toFixed(6)).toString();
}
