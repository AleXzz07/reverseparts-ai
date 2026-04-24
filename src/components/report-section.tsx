export function ReportSection({
  title,
  items,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  tone?: "neutral" | "warning" | "danger";
}) {
  const color =
    tone === "danger"
      ? "border-red-200 bg-red-50"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50"
        : "border-[var(--line)] bg-white";

  return (
    <section className={`rounded-lg border p-4 ${color}`}>
      <h3 className="mb-3 font-semibold">{title}</h3>
      {items.length ? (
        <ul className="space-y-2 text-sm leading-6">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted)]">Nessun dato disponibile.</p>
      )}
    </section>
  );
}
