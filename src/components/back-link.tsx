import Link from "next/link";

export function BackLink({
  href = "/dashboard",
  label = "Indietro",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <Link
      href={href}
      className="mb-6 inline-flex text-sm font-semibold text-[var(--accent-strong)] hover:underline"
    >
      ← {label}
    </Link>
  );
}
