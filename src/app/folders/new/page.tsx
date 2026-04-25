import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BackLink } from "@/components/back-link";
import { FolderForm } from "@/components/folder-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewFolderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell>
      <BackLink />
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase text-[var(--accent)]">
          Nuova cartella
        </p>
        <h1 className="text-3xl font-semibold">Organizza i componenti</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Usa le cartelle per raggruppare componenti per cliente, commessa,
          macchina o fase di lavoro.
        </p>
      </div>
      <FolderForm userId={user.id} />
    </AppShell>
  );
}
