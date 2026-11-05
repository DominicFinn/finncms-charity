import type { AnswerValue, Question } from "@ccm/shared";
import { useState } from "react";
import { cleanAnswers, formatAnswer, validateAnswers } from "@/lib/answers";
import { QuestionInput } from "./QuestionInput";
import { Button } from "./ui/button";

/** Edits answers to an ordered list of questions. Blank answers are dropped on save. */
export function AnswerForm({
  questions,
  initial,
  onSave,
  onCancel,
  busy,
  saveLabel = "Save answers",
}: {
  questions: Question[];
  initial?: Record<string, AnswerValue>;
  onSave: (answers: Record<string, AnswerValue>) => void;
  onCancel?: () => void;
  busy?: boolean;
  saveLabel?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const errs = validateAnswers(questions, answers);
        setErrors(errs);
        if (Object.keys(errs).length === 0) onSave(cleanAnswers(answers));
      }}
    >
      {questions.map((q) => (
        <QuestionInput
          key={q.id}
          question={q}
          value={answers[q.id]}
          error={errors[q.id]}
          onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
        />
      ))}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{saveLabel}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

export function AnswerList({ questions, answers }: { questions: Question[]; answers: Record<string, AnswerValue> }) {
  return (
    <dl className="flex flex-col divide-y">
      {questions.map((q) => (
        <div key={q.id} className="grid gap-0.5 py-2 sm:grid-cols-2 sm:gap-4">
          <dt className="text-sm text-muted-foreground">{q.text}</dt>
          <dd className="whitespace-pre-wrap">{formatAnswer(q, answers[q.id])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Questions of a set, in set order, skipping any that no longer exist. */
export function questionsFor(questionIds: string[], all: Question[] | undefined): Question[] {
  if (!all) return [];
  const byId = new Map(all.map((q) => [q.id, q]));
  return questionIds.map((id) => byId.get(id)).filter((q): q is Question => !!q);
}
