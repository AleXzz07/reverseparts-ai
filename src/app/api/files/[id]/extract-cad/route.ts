import { NextResponse } from "next/server";
import { isStepFile } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import type { ComponentFile, ComponentProject } from "@/lib/types";

const MAX_CAD_FILE_BYTES = 80 * 1024 * 1024;
const VERCEL_STP_FALLBACK_MESSAGE =
  "Analisi STP avanzata non disponibile su Vercel. Serve backend Python dedicato.";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non autenticato." }, { status: 401 });
  }

  const { data: file, error: fileError } = await supabase
    .from("component_files")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fileError || !file) {
    return NextResponse.json({ error: "File non trovato." }, { status: 404 });
  }

  const componentFile = file as ComponentFile;

  if (!isStepFile(componentFile.file_name)) {
    return NextResponse.json(
      { error: "La route CAD avanzata supporta solo file STP/STEP." },
      { status: 400 },
    );
  }

  if (componentFile.file_size > MAX_CAD_FILE_BYTES) {
    const message = "Il file CAD supera il limite di 80 MB per l'analisi automatica.";
    await saveFailedExtraction(componentFile, user.id, message);
    return NextResponse.json({ status: "failed", message });
  }

  const apiUrl = process.env.CAD_ANALYSIS_API_URL?.trim();

  if (!apiUrl) {
    await saveFailedExtraction(componentFile, user.id, VERCEL_STP_FALLBACK_MESSAGE);
    return NextResponse.json({
      status: "fallback",
      message: VERCEL_STP_FALLBACK_MESSAGE,
    });
  }

  const { data, error: downloadError } = await supabase.storage
    .from("component-files")
    .download(componentFile.file_path);

  if (downloadError || !data) {
    const message = `Impossibile leggere il file ${componentFile.file_name}.`;
    await saveFailedExtraction(componentFile, user.id, message);
    return NextResponse.json({ status: "failed", message });
  }

  const { data: component } = await supabase
    .from("components")
    .select("notes")
    .eq("id", componentFile.component_id)
    .eq("user_id", user.id)
    .single();

  try {
    const extractedData = await sendToCadAnalysisApi(
      apiUrl,
      componentFile,
      data,
      (component as Pick<ComponentProject, "notes"> | null)?.notes ?? "",
    );

    const { error: upsertError } = await supabase.from("cad_feature_extractions").upsert(
      {
        component_id: componentFile.component_id,
        component_file_id: componentFile.id,
        user_id: user.id,
        status: "success",
        error_message: null,
        extracted_data: extractedData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "component_file_id" },
    );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ status: "success", extracted_data: extractedData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backend CAD non disponibile.";
    await saveFailedExtraction(componentFile, user.id, message);
    return NextResponse.json({ status: "failed", message });
  }
}

async function sendToCadAnalysisApi(
  apiUrl: string,
  file: ComponentFile,
  data: Blob,
  notes: string,
) {
  const formData = new FormData();
  formData.append("file", data, file.file_name);
  formData.append("component_file_id", file.id);
  formData.append("component_id", file.component_id);
  if (notes.trim()) {
    formData.append("notes", notes);
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Backend CAD ha risposto ${response.status}${text ? `: ${text}` : ""}`,
    );
  }

  const payload = (await response.json()) as { extracted_data?: unknown } | unknown;
  if (
    payload &&
    typeof payload === "object" &&
    "extracted_data" in payload &&
    (payload as { extracted_data?: unknown }).extracted_data
  ) {
    return (payload as { extracted_data: unknown }).extracted_data;
  }

  return payload;
}

async function saveFailedExtraction(
  file: ComponentFile,
  userId: string,
  message: string,
) {
  const supabase = await createClient();
  await supabase.from("cad_feature_extractions").upsert(
    {
      component_id: file.component_id,
      component_file_id: file.id,
      user_id: userId,
      status: "failed",
      error_message: message,
      extracted_data: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "component_file_id" },
  );
}
