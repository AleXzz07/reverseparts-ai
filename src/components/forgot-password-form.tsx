"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    const supabase = createClient();

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("Email inviata. Controlla la casella e apri il link di reset.");
  }

  return (
    <form onSubmit={submit} className="panel w-full max-w-md p-8 shadow-sm">
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="mb-2 block font-mono text-xs uppercase tracking-wide text-[var(--accent)]"
        >
          REVERSEPARTS
        </Link>
        <h1 className="text-3xl font-semibold">Recupera password</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Inserisci l&apos;email del tuo account per ricevere il link di reset.
        </p>
      </div>

      <label className="mb-6 block">
        <span className="mb-2 block text-sm font-medium">Email</span>
        <input
          className="field"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
      </label>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <button className="button button-primary w-full" disabled={loading}>
        {loading ? "Invio..." : "Invia email reset"}
      </button>

      <p className="mt-5 flex justify-center gap-4 text-sm">
        <Link className="font-semibold text-[var(--accent-strong)]" href="/login">
          ← Indietro
        </Link>
        <Link className="font-semibold text-[var(--accent-strong)]" href="/dashboard">
          Dashboard
        </Link>
      </p>
    </form>
  );
}
