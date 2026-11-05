import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Multi-select as a wrap of toggle buttons. Easier on a phone than a listbox. */
export function ChipPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm",
                on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
              )}
            >
              {on && <Check className="size-4" aria-hidden />}
              {o.name}
            </button>
          );
        })}
        {options.length === 0 && <p className="text-sm text-muted-foreground">None set up yet.</p>}
      </div>
    </fieldset>
  );
}
