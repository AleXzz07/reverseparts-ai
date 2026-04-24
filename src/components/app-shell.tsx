import Link from "next/link";
import { FolderPlus, Plus } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/dashboard" className="font-mono text-lg font-bold">
            REVERSEPARTS
          </Link>
          <nav className="flex items-center gap-3">
            <Link className="button button-secondary" href="/folders/new">
              <FolderPlus aria-hidden size={16} />
              Nuova cartella
            </Link>
            <Link className="button button-primary" href="/components/new">
              <Plus aria-hidden size={16} />
              Nuovo componente
            </Link>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
    </main>
  );
}
