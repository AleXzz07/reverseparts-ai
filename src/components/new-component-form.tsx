"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import {
  getStoredContentType,
  isPdfFile,
  isStlFile,
  isSupportedUpload,
  supportedUploadExtensions,
} from "@/lib/files";
import type { Folder } from "@/lib/types";

export function NewComponentForm({
  userId,
  folders,
}: {
  userId: string;
  folders: Folder[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const selectedFiles = Array.from(files ?? []);
    const invalidFile = selectedFiles.find((file) => !isSupportedUpload(file.name));
    const supabase = createClient();

    if (invalidFile) {
      setError(`Formato non supportato: ${invalidFile.name}`);
      setLoading(false);
      return;
    }

    const { data: component, error: componentError } = await supabase
      .from("components")
      .insert({ title, notes, user_id: userId, folder_id: folderId || null })
      .select("id")
      .single();

    if (componentError || !component) {
      setError(componentError?.message ?? "Impossibile creare il componente.");
      setLoading(false);
      return;
    }

    for (const file of selectedFiles) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${component.id}/${crypto.randomUUID()}-${safeName}`;
      const contentType = getStoredContentType(file);
      const { error: uploadError } = await supabase.storage
        .from("component-files")
        .upload(path, file, { contentType });

      if (uploadError) {
        setError(uploadError.message);
        setLoading(false);
        return;
      }

      const { data: savedFile, error: fileError } = await supabase
        .from("component_files")
        .insert({
          component_id: component.id,
          user_id: userId,
          file_name: file.name,
          file_path: path,
          file_type: contentType,
          file_size: file.size,
        })
        .select("id")
        .single();

      if (fileError || !savedFile) {
        setError(fileError?.message ?? "Impossibile salvare il riferimento del file.");
        setLoading(false);
        return;
      }

      if (isStlFile(file.name)) {
        const analysisResponse = await fetch(`/api/files/${savedFile.id}/analyze-stl`, {
          method: "POST",
        });

        if (!analysisResponse.ok) {
          const payload = (await analysisResponse.json().catch(() => null)) as
            | { error?: string }
            | null;
          setError(
            payload?.error ??
              `Il file STL ${file.name} e' stato caricato ma non e' analizzabile.`,
          );
          setLoading(false);
          return;
        }
      }

      if (isPdfFile(file.name, contentType)) {
        const extractionResponse = await fetch(`/api/files/${savedFile.id}/extract-pdf`, {
          method: "POST",
        });

        if (!extractionResponse.ok) {
          const payload = (await extractionResponse.json().catch(() => null)) as
            | { error?: string }
            | null;
          setError(
            payload?.error ??
              `Il PDF ${file.name} e' stato caricato ma i dati non sono estraibili.`,
          );
          setLoading(false);
          return;
        }
      }
    }

    router.push("/dashboard?created=component");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="panel p-6">
        <h2 className="mb-5 text-xl font-semibold">Dati iniziali</h2>
        <label className="mb-5 block">
          <span className="mb-2 block text-sm font-medium">Nome interno</span>
          <input
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Es. Staffa supporto motore"
            required
          />
        </label>
        <label className="mb-5 block">
          <span className="mb-2 block text-sm font-medium">Cartella</span>
          <select
            className="field"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            <option value="">Senza cartella</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">Note tecniche</span>
          <textarea
            className="field min-h-72 resize-y leading-6"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Inserisci misure note, materiale dichiarato, contesto d'uso, vincoli, difetti visibili o richieste del cliente."
          />
        </label>
      </section>

      <section className="panel p-6">
        <h2 className="mb-5 text-xl font-semibold">Documentazione tecnica</h2>
        <label className="flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--line)] bg-[#faf9f5] p-6 text-center">
          <UploadCloud aria-hidden size={34} className="mb-4 text-[var(--accent)]" />
          <span className="font-semibold">Carica immagini, PDF o CAD/3D</span>
          <span className="mt-2 text-sm leading-6 text-[var(--muted)]">
            PNG, JPG, WEBP, PDF, STL, STEP, IGES, Parasolid, OBJ, 3MF, DXF e DWG.
            I file restano nel bucket privato Supabase.
          </span>
          <input
            className="sr-only"
            type="file"
            multiple
            accept={supportedUploadExtensions.join(",")}
            onChange={(event) => setFiles(event.target.files)}
          />
        </label>

        {(files?.length ?? 0) > 0 ? (
          <ul className="mt-4 space-y-2 text-sm">
            {Array.from(files ?? []).map((file) => (
              <li key={`${file.name}-${file.size}`} className="rounded-md bg-[#eeece5] px-3 py-2">
                {file.name}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button className="button button-primary mt-6 w-full" disabled={loading}>
          {loading ? "Salvataggio..." : "Crea componente"}
        </button>
      </section>
    </form>
  );
}
