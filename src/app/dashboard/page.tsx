import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Folder, Gauge, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DeleteComponentButton } from "@/components/delete-component-button";
import { createClient } from "@/lib/supabase/server";
import type { ComponentProject, Folder as FolderRow } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: components, error: componentsError }, { data: folders, error: foldersError }] =
    await Promise.all([
      supabase.from("components").select("*").order("created_at", { ascending: false }),
      supabase.from("folders").select("*").order("created_at", { ascending: false }),
    ]);

  if (componentsError || foldersError) {
    throw new Error(componentsError?.message ?? foldersError?.message);
  }

  const componentRows = (components as ComponentProject[]) ?? [];
  const folderRows = (folders as FolderRow[]) ?? [];
  const componentsByFolder = new Map<string, ComponentProject[]>();
  const unfiledComponents = componentRows.filter((component) => !component.folder_id);

  for (const folder of folderRows) {
    componentsByFolder.set(
      folder.id,
      componentRows.filter((component) => component.folder_id === folder.id),
    );
  }

  const hasContent = componentRows.length > 0 || folderRows.length > 0;

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

      {hasContent ? (
        <div className="space-y-6">
          {folderRows.map((folder) => (
            <ComponentGroup
              key={folder.id}
              title={folder.name}
              description={folder.description}
              components={componentsByFolder.get(folder.id) ?? []}
            />
          ))}
          {unfiledComponents.length ? (
            <ComponentGroup
              title="Senza cartella"
              description="Componenti non ancora assegnati a un progetto."
              components={unfiledComponents}
            />
          ) : null}
          {!componentRows.length ? (
            <div className="panel p-6">
              <p className="text-sm text-[var(--muted)]">
                Le cartelle sono pronte. Crea un componente per iniziare a
                popolarle.
              </p>
            </div>
          ) : null}
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

function ComponentGroup({
  title,
  description,
  components,
}: {
  title: string;
  description?: string;
  components: ComponentProject[];
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-start gap-3 border-b border-[var(--line)] bg-[#eeece5] px-4 py-4">
        <Folder aria-hidden size={20} className="mt-0.5 text-[var(--accent)]" />
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
          ) : null}
        </div>
      </div>
      {components.length ? (
        <div>
          <div className="grid grid-cols-12 border-b border-[var(--line)] bg-[#f8f6ef] px-4 py-3 text-xs font-semibold uppercase text-[var(--muted)]">
            <span className="col-span-5">Componente</span>
            <span className="col-span-2">Stato</span>
            <span className="col-span-3">Creato</span>
            <span className="col-span-2 text-right">Azioni</span>
          </div>
          {components.map((component) => (
            <div
              key={component.id}
              className="grid grid-cols-12 items-center gap-3 border-b border-[var(--line)] px-4 py-4 last:border-b-0"
            >
              <Link
                href={`/components/${component.id}`}
                className="col-span-5 flex items-center gap-3 font-medium hover:text-[var(--accent-strong)]"
              >
                <FileText aria-hidden size={18} className="text-[var(--accent)]" />
                <span className="break-words">{component.title}</span>
              </Link>
              <span className="col-span-2">
                <span className="rounded-full bg-[#e2eee8] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                  {component.status === "generated" ? "Scheda AI" : "Bozza"}
                </span>
              </span>
              <span className="col-span-3 text-sm text-[var(--muted)]">
                {new Intl.DateTimeFormat("it-IT", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(component.created_at))}
              </span>
              <div className="col-span-2 flex justify-end">
                <DeleteComponentButton
                  componentId={component.id}
                  componentTitle={component.title}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">
          Nessun componente in questa cartella.
        </p>
      )}
    </section>
  );
}
