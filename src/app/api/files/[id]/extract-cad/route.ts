import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { isCadFeatureFile } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import type { ComponentFile } from "@/lib/types";

const execFileAsync = promisify(execFile);
const MAX_CAD_FILE_BYTES = 80 * 1024 * 1024;

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

  if (!isCadFeatureFile(componentFile.file_name)) {
    return NextResponse.json(
      { error: "Il file non e' supportato dal CAD feature extractor." },
      { status: 400 },
    );
  }

  if (componentFile.file_size > MAX_CAD_FILE_BYTES) {
    return NextResponse.json(
      { error: "Il file CAD supera il limite di 80 MB per l'estrazione automatica." },
      { status: 400 },
    );
  }

  const { data, error: downloadError } = await supabase.storage
    .from("component-files")
    .download(componentFile.file_path);

  if (downloadError || !data) {
    return NextResponse.json(
      { error: `Impossibile leggere il file ${componentFile.file_name}.` },
      { status: 500 },
    );
  }

  const workDir = path.join(tmpdir(), `reverseparts-cad-${randomUUID()}`);
  const inputPath = path.join(workDir, safeTempFileName(componentFile.file_name));

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(inputPath, Buffer.from(await data.arrayBuffer()));

    const extractedData = await runCadExtractor(inputPath);

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

    return NextResponse.json({ extracted_data: extractedData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore inatteso.";

    await supabase.from("cad_feature_extractions").upsert(
      {
        component_id: componentFile.component_id,
        component_file_id: componentFile.id,
        user_id: user.id,
        status: "failed",
        error_message: message,
        extracted_data: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "component_file_id" },
    );

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runCadExtractor(inputPath: string) {
  const scriptPath = path.join(process.cwd(), "tools", "cad_feature_extractor", "extractor.py");
  const pythonCommand = process.env.PYTHON_BIN || "python";
  const { stdout } = await execFileAsync(pythonCommand, [scriptPath, inputPath], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON non valido.";
    throw new Error(`CAD extractor non ha prodotto JSON valido: ${message}`);
  }
}

function safeTempFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
