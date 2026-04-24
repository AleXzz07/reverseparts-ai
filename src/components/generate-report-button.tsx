"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export function GenerateReportButton({ componentId }: { componentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    setLoading(true);

    const response = await fetch(`/api/components/${componentId}/generate-report`, {
      method: "POST",
    });

    setLoading(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Generazione non riuscita.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <button className="button button-primary" type="button" onClick={generate} disabled={loading}>
        <Sparkles aria-hidden size={16} />
        {loading ? "Generazione..." : "Genera scheda AI"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
