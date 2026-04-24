import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Gauge, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import type { ComponentProject } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: components, error } = await supabase
    .from("components")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <AppShell>
      <section className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 font-mono text-xs uppercase text-[var(--accent)]">
            Dashboard
          </p>
          <h1 className="text-3xl font-semibold">Componenti e progetti</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Archivio dei componenti caricati, con note tecniche, file sorgente e
              schede AI preliminari.
          </p>
        </div>
        <Link className="button button-primary" href="/components/new">
          <Plus aria-hidden size={16} />
          Nuovo componente
        </Link>
      </section>

      {components?.length ? (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-12 border-b border-[var(--line)] bg-[#eeece5] px-4 py-3 text-xs font-semibold uppercase text-[var(--muted)]">
            <span className="col-span-6">Componente</span>
            <span className="col-span-2">Stato</span>
            <span className="col-span-4">Creato</span>
          </div>
          {(components as ComponentProject[]).map((component) => (
            <Link
              href={`/components/${component.id}`}
              key={component.id}
              className="grid grid-cols-12 items-center border-b border-[var(--line)] px-4 py-4 last:border-b-0 hover:bg-[#faf9f5]"
            >
              <span className="col-span-6 flex items-center gap-3 font-medium">
                <FileText aria-hidden size={18} className="text-[var(--accent)]" />
                {component.title}
              </span>
              <span className="col-span-2">
                <span className="rounded-full bg-[#e2eee8] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                  {component.status === "generated" ? "Scheda AI" : "Bozza"}
                </span>
              </span>
              <span className="col-span-4 text-sm text-[var(--muted)]">
                {new Intl.DateTimeFormat("it-IT", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(component.created_at))}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel flex flex-col items-start gap-5 p-8">
          <Gauge aria-hidden size={36} className="text-[var(--accent)]" />
          <div>
            <h2 className="text-xl font-semibold">Nessun componente ancora</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
              Crea il primo componente caricando foto, PDF e note tecniche. La
              scheda generata restera&apos; separata tra dati certi, ipotesi e dati
              mancanti.
            </p>
          </div>
          <Link className="button button-primary" href="/components/new">
            <Plus aria-hidden size={16} />
            Nuovo componente
          </Link>
        </div>
      )}
    </AppShell>
  );
}
