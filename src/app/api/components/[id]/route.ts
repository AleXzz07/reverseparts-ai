import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ComponentFile } from "@/lib/types";

export async function DELETE(
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

  const { data: component, error: componentError } = await supabase
    .from("components")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (componentError || !component) {
    return NextResponse.json({ error: "Componente non trovato." }, { status: 404 });
  }

  const { data: files, error: filesError } = await supabase
    .from("component_files")
    .select("*")
    .eq("component_id", id)
    .eq("user_id", user.id);

  if (filesError) {
    return NextResponse.json({ error: filesError.message }, { status: 500 });
  }

  const filePaths = ((files as ComponentFile[] | null) ?? []).map((file) => file.file_path);

  if (filePaths.length) {
    const { error: storageError } = await supabase.storage
      .from("component-files")
      .remove(filePaths);

    if (storageError) {
      return NextResponse.json({ error: storageError.message }, { status: 500 });
    }
  }

  await supabase.from("ai_reports").delete().eq("component_id", id).eq("user_id", user.id);
  await supabase.from("component_files").delete().eq("component_id", id).eq("user_id", user.id);

  const { error: deleteError } = await supabase
    .from("components")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
