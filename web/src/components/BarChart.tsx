/** Horizontal bar chart from plain CSS. Each row is labelled so it reads well to screen readers too. */
export function BarChart({
  rows,
  valueLabel,
  format = (n) => n.toLocaleString("en-GB"),
}: {
  rows: { label: string; value: number }[];
  valueLabel: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0) return null;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-muted-foreground">{valueLabel}</figcaption>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-2 text-sm">
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
            <span className="h-5 rounded-sm bg-muted" aria-hidden>
              <span
                className="block h-full rounded-sm bg-primary"
                style={{ width: max > 0 ? `${Math.max(1, (r.value / max) * 100)}%` : 0 }}
              />
            </span>
            <span className="tabular-nums">{format(r.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
