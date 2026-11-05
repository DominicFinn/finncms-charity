import type { AnswerValue, Question } from "@ccm/shared";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { Input, Textarea } from "./ui/input";

/** One question rendered by type. Uses fieldset/legend so grouped controls are announced with the question. */
export function QuestionInput({
  question: q,
  value,
  onChange,
  error,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  error?: string;
}) {
  const id = useId();
  const errId = error ? `${id}-err` : undefined;
  const helpId = q.helpText ? `${id}-help` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;

  const control = (() => {
    switch (q.type) {
      case "text":
        return (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
          />
        );
      case "number":
        return (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            aria-describedby={describedBy}
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            className="max-w-48"
          />
        );
      case "date":
        return (
          <Input
            id={id}
            type="date"
            aria-describedby={describedBy}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="max-w-56"
          />
        );
      case "yes_no":
        return (
          <Choices
            name={id}
            options={[
              { label: "Yes", value: true },
              { label: "No", value: false },
            ]}
            selected={(v) => value === v}
            onPick={(v) => onChange(value === v ? null : v)}
          />
        );
      case "single_choice":
        return (
          <Choices
            name={id}
            options={(q.options ?? []).map((o) => ({ label: o, value: o }))}
            selected={(v) => value === v}
            onPick={(v) => onChange(value === v ? null : v)}
          />
        );
      case "multiple_choice": {
        const arr = Array.isArray(value) ? value : [];
        return (
          <Choices
            name={id}
            multi
            options={(q.options ?? []).map((o) => ({ label: o, value: o }))}
            selected={(v) => arr.includes(v as string)}
            onPick={(v) => onChange(arr.includes(v as string) ? arr.filter((x) => x !== v) : [...arr, v as string])}
          />
        );
      }
      case "scale": {
        const min = q.scale?.min ?? 1;
        const max = q.scale?.max ?? 5;
        const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
        return (
          <div className="flex flex-col gap-1">
            <Choices
              name={id}
              compact
              options={steps.map((n) => ({ label: String(n), value: n }))}
              selected={(v) => value === v}
              onPick={(v) => onChange(value === v ? null : v)}
            />
            {(q.scale?.minLabel || q.scale?.maxLabel) && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{q.scale?.minLabel}</span>
                <span>{q.scale?.maxLabel}</span>
              </div>
            )}
          </div>
        );
      }
    }
  })();

  const grouped = q.type === "yes_no" || q.type === "single_choice" || q.type === "multiple_choice" || q.type === "scale";
  const label = <span className="font-medium">{q.text}</span>;

  return (
    <div className="flex flex-col gap-2">
      {grouped ? (
        <fieldset aria-describedby={describedBy} className="flex flex-col gap-2">
          <legend>{label}</legend>
          {q.helpText && (
            <p id={helpId} className="text-sm text-muted-foreground">
              {q.helpText}
            </p>
          )}
          {control}
        </fieldset>
      ) : (
        <>
          <label htmlFor={id}>{label}</label>
          {q.helpText && (
            <p id={helpId} className="text-sm text-muted-foreground">
              {q.helpText}
            </p>
          )}
          {control}
        </>
      )}
      {error && (
        <p id={errId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Choices<T extends string | number | boolean>({
  name,
  options,
  selected,
  onPick,
  multi,
  compact,
}: {
  name: string;
  options: { label: string; value: T }[];
  selected: (v: T) => boolean;
  onPick: (v: T) => void;
  multi?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
      {options.map((o) => {
        const on = selected(o.value);
        return (
          <label
            key={String(o.value)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
              compact && "min-w-11 px-2",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
            )}
          >
            <input
              type={multi ? "checkbox" : "radio"}
              name={name}
              className="sr-only"
              checked={on}
              onChange={() => onPick(o.value)}
              onClick={(e) => {
                // Clicking a selected radio clears it.
                if (!multi && on) {
                  e.preventDefault();
                  onPick(o.value);
                }
              }}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
