"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type AuthFormProps = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/dashboard`,
            },
          });

    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage("Controlla la tua email per confermare la registrazione.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="panel w-full max-w-md p-8 shadow-sm">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--accent)]">
          REVERSEPARTS
        </p>
        <h1 className="text-3xl font-semibold">
          {mode === "login" ? "Accedi" : "Crea account"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Carica foto, PDF e note tecniche per generare una scheda preliminare
          verificabile.
        </p>
      </div>

      <label className="mb-4 block">
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

      <label className="mb-6 block">
        <span className="mb-2 block text-sm font-medium">Password</span>
        <input
          className="field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
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
        {loading ? "Attendi..." : mode === "login" ? "Accedi" : "Registrati"}
      </button>

      <p className="mt-5 text-center text-sm text-[var(--muted)]">
        {mode === "login" ? "Non hai un account?" : "Hai gia' un account?"}{" "}
        <Link
          className="font-semibold text-[var(--accent-strong)]"
          href={mode === "login" ? "/signup" : "/login"}
        >
          {mode === "login" ? "Registrati" : "Accedi"}
        </Link>
      </p>
    </form>
  );
}
