"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function FolderForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const { error: insertError } = await supabase.from("folders").insert({
      user_id: userId,
      name,
      description,
    });

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="panel max-w-2xl p-6">
      <label className="mb-5 block">
        <span className="mb-2 block text-sm font-medium">Nome cartella</span>
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Es. Riduttori linea A"
          required
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium">Descrizione</span>
        <textarea
          className="field min-h-32 resize-y leading-6"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Contesto, cliente, commessa o obiettivo della raccolta."
        />
      </label>
      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button className="button button-primary mt-6" disabled={loading}>
        {loading ? "Salvataggio..." : "Crea cartella"}
      </button>
    </form>
  );
}
