import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const { data: folder, error: folderError } = await supabase
    .from("folders")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (folderError || !folder) {
    return NextResponse.json({ error: "Cartella non trovata." }, { status: 404 });
  }

  const { error: detachError } = await supabase
    .from("components")
    .update({ folder_id: null, updated_at: new Date().toISOString() })
    .eq("folder_id", id)
    .eq("user_id", user.id);

  if (detachError) {
    return NextResponse.json({ error: detachError.message }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("folders")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
