import { NextResponse } from "next/server";
import { extractPdfDataFromBuffer } from "@/lib/pdf-extractor";
import { createClient } from "@/lib/supabase/server";
import type { ComponentFile } from "@/lib/types";

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

  if (componentFile.file_type !== "application/pdf") {
    return NextResponse.json({ error: "Il file non e' un PDF." }, { status: 400 });
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

  const buffer = Buffer.from(await data.arrayBuffer());
  const extractedData = extractPdfDataFromBuffer(buffer);

  const { error: updateError } = await supabase
    .from("component_files")
    .update({ extracted_pdf_data: extractedData })
    .eq("id", componentFile.id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ extracted_pdf_data: extractedData });
}
