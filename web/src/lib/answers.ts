import type { AnswerValue, Question } from "@ccm/shared";

/** Returns an error message, or null when the answer is acceptable. Blank answers are allowed. */
export function validateAnswer(q: Question, value: AnswerValue | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (q.type) {
    case "text":
      return typeof value === "string" ? null : "Enter some text";
    case "yes_no":
      return typeof value === "boolean" ? null : "Choose yes or no";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "Enter a number";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Enter a date";
    case "single_choice":
      return typeof value === "string" && (q.options ?? []).includes(value) ? null : "Choose one of the options";
    case "multiple_choice":
      return Array.isArray(value) && value.every((v) => (q.options ?? []).includes(v)) ? null : "Choose from the options";
    case "scale": {
      if (typeof value !== "number") return "Choose a value";
      const min = q.scale?.min ?? 1;
      const max = q.scale?.max ?? 5;
      return value >= min && value <= max ? null : `Choose a value from ${min} to ${max}`;
    }
  }
}

export function validateAnswers(questions: Question[], answers: Record<string, AnswerValue>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const e = validateAnswer(q, answers[q.id]);
    if (e) errors[q.id] = e;
  }
  return errors;
}

/** Drops blank answers so a saved version only holds what was given. */
export function cleanAnswers(answers: Record<string, AnswerValue>): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function formatAnswer(q: Question | undefined, value: AnswerValue | undefined): string {
  if (value === null || value === undefined || value === "") return "Not answered";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not answered";
  if (q?.type === "scale" && typeof value === "number") {
    const max = q.scale?.max ?? 5;
    return `${value} of ${max}`;
  }
  if (q?.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return String(value);
}
