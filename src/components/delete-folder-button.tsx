"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteFolderButton({
  folderId,
  folderName,
  componentCount,
}: {
  folderId: string;
  folderName: string;
  componentCount: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteFolder() {
    const warning =
      componentCount > 0
        ? `La cartella contiene ${componentCount} componenti. Verrà eliminata solo la cartella: i componenti resteranno disponibili in "Senza cartella".`
        : "La cartella non contiene componenti.";

    const confirmed = window.confirm(`Eliminare "${folderName}"?\n\n${warning}`);

    if (!confirmed) {
      return;
    }

    setError(null);
    setLoading(true);

    const response = await fetch(`/api/folders/${folderId}`, {
      method: "DELETE",
    });

    setLoading(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Eliminazione cartella non riuscita.");
      return;
    }

    router.push("/dashboard?deleted=folder");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="button button-secondary px-3 py-2 text-sm text-[var(--danger)]"
        type="button"
        onClick={deleteFolder}
        disabled={loading}
      >
        <Trash2 aria-hidden size={15} />
        {loading ? "Elimino..." : "Elimina"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
