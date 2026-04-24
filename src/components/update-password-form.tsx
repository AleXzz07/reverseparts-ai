"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    async function prepareRecoverySession() {
      const code = new URLSearchParams(window.location.search).get("code");

      if (code) {
        const supabase = createClient();
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
        }
      }

      setInitializing(false);
    }

    void prepareRecoverySession();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Password aggiornata. Reindirizzamento alla dashboard...");
    router.refresh();
    setTimeout(() => router.push("/dashboard"), 900);
  }

  return (
    <form onSubmit={submit} className="panel w-full max-w-md p-8 shadow-sm">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--accent)]">
          REVERSEPARTS
        </p>
        <h1 className="text-3xl font-semibold">Nuova password</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Imposta una nuova password per completare il recupero account.
        </p>
      </div>

      <label className="mb-4 block">
        <span className="mb-2 block text-sm font-medium">Nuova password</span>
        <input
          className="field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>

      <label className="mb-6 block">
        <span className="mb-2 block text-sm font-medium">Conferma password</span>
        <input
          className="field"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
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

      <button className="button button-primary w-full" disabled={loading || initializing}>
        {initializing ? "Verifica link..." : loading ? "Aggiornamento..." : "Aggiorna password"}
      </button>

      <p className="mt-5 text-center text-sm">
        <Link className="font-semibold text-[var(--accent-strong)]" href="/login">
          Torna al login
        </Link>
      </p>
    </form>
  );
}
