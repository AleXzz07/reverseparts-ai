import { NextResponse } from "next/server";
import { isStlFile } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import { parseStlGeometry } from "@/lib/stl/parser";
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

  if (!isStlFile(componentFile.file_name)) {
    return NextResponse.json(
      { error: "Solo i file .stl sono supportati per l'analisi geometrica." },
      { status: 400 },
    );
  }

  try {
    const { data, error: downloadError } = await supabase.storage
      .from("component-files")
      .download(componentFile.file_path);

    if (downloadError || !data) {
      throw new Error(`Impossibile leggere il file STL ${componentFile.file_name}.`);
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const geometry = parseStlGeometry(buffer);

    const { error: upsertError } = await supabase.from("stl_geometry_analyses").upsert(
      {
        component_id: componentFile.component_id,
        component_file_id: componentFile.id,
        user_id: user.id,
        status: "success",
        error_message: null,
        bounding_box: geometry.bounding_box,
        dimensions: geometry.dimensions,
        volume_estimated: geometry.volume_estimated,
        surface_area: geometry.surface_area,
        triangle_count: geometry.triangle_count,
        presumed_unit: geometry.presumed_unit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "component_file_id" },
    );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ geometry });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `Il file STL ${componentFile.file_name} non e' analizzabile.`;

    const { error: upsertError } = await supabase.from("stl_geometry_analyses").upsert(
      {
        component_id: componentFile.component_id,
        component_file_id: componentFile.id,
        user_id: user.id,
        status: "failed",
        error_message: message,
        bounding_box: null,
        dimensions: null,
        volume_estimated: null,
        surface_area: null,
        triangle_count: null,
        presumed_unit: "mm presunti (STL unitless)",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "component_file_id" },
    );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ error: message }, { status: 422 });
  }
}
