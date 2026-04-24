import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NewComponentForm } from "@/components/new-component-form";
import { createClient } from "@/lib/supabase/server";
import type { Folder } from "@/lib/types";

export default async function NewComponentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: folders, error } = await supabase
    .from("folders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <AppShell>
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase text-[var(--accent)]">
          Nuovo componente
        </p>
        <h1 className="text-3xl font-semibold">Carica documentazione</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Aggiungi foto, PDF e note tecniche. La generazione AI parte dal
          dettaglio del componente, dopo il salvataggio.
        </p>
      </div>
      <NewComponentForm userId={user.id} folders={(folders as Folder[]) ?? []} />
    </AppShell>
  );
}
