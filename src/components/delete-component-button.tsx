"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteComponentButton({
  componentId,
  componentTitle,
}: {
  componentId: string;
  componentTitle: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteComponent() {
    const confirmed = window.confirm(
      `Eliminare "${componentTitle}"? Verranno rimossi anche file e schede AI collegati.`,
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setLoading(true);

    const response = await fetch(`/api/components/${componentId}`, {
      method: "DELETE",
    });

    setLoading(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Eliminazione non riuscita.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="button button-secondary px-3 py-2 text-sm text-[var(--danger)]"
        type="button"
        onClick={deleteComponent}
        disabled={loading}
      >
        <Trash2 aria-hidden size={15} />
        {loading ? "Elimino..." : "Elimina"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
