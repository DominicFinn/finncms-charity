import { QUESTION_TYPES, type Question, type QuestionType } from "@ccm/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { QuestionInput } from "@/components/QuestionInput";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { useOpMutation, useQuestions } from "@/hooks/api";
import { humanise } from "@/lib/format";

const TYPE_LABELS: Record<QuestionType, string> = {
  text: "Free text",
  yes_no: "Yes or no",
  single_choice: "Pick one",
  multiple_choice: "Pick any",
  number: "Number",
  date: "Date",
  scale: "Scale",
};

export function QuestionsAdmin() {
  const [showArchived, setShowArchived] = useState(false);
  const questions = useQuestions(showArchived);
  const [editing, setEditing] = useState<Question | "new" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        Questions are reusable. Build them here, then group them into questionnaires and outcome measures.
      </p>
      {editing ? (
        <QuestionEditor question={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setEditing("new")}><Plus /> New question</Button>
          <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        </div>
      )}
      <QueryView query={questions}>
        {(list) =>
          list.length ? (
            <ul className="flex flex-col gap-2">
              {list.map((q) => (
                <li key={q.id} className="flex items-start justify-between gap-2 rounded-lg border bg-card p-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{q.text}</span>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant="outline">{TYPE_LABELS[q.type]}</Badge>
                      {q.archived && <Badge variant="secondary">Archived</Badge>}
                    </span>
                    {q.options && q.options.length > 0 && <span className="text-sm text-muted-foreground">{q.options.join(" · ")}</span>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditing(q)}>Edit</Button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No questions yet.</Empty>
          )
        }
      </QueryView>
    </div>
  );
}

function QuestionEditor({ question, onDone }: { question?: Question; onDone: () => void }) {
  const [q, setQ] = useState<Question>(
    question ?? { id: "", text: "", type: "yes_no", archived: false, options: [], scale: { min: 1, max: 5 } },
  );
  const [optionsText, setOptionsText] = useState((question?.options ?? []).join("\n"));
  const save = useOpMutation("questions.upsert", ["questions.list"]);
  const hasOptions = q.type === "single_choice" || q.type === "multiple_choice";
  const options = optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
  const preview: Question = { ...q, options };

  return (
    <Card>
      <CardHeader><CardTitle>{question ? "Edit question" : "New question"}</CardTitle></CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              {
                id: question?.id,
                text: q.text,
                helpText: q.helpText || undefined,
                type: q.type,
                options: hasOptions ? options : undefined,
                scale: q.type === "scale" ? q.scale : undefined,
                archived: q.archived,
              },
              { onSuccess: onDone },
            );
          }}
        >
          <Field label="Question"><Textarea required rows={2} value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })} /></Field>
          <Field label="Help text" hint="Optional guidance shown under the question.">
            <Input value={q.helpText ?? ""} onChange={(e) => setQ({ ...q, helpText: e.target.value })} />
          </Field>
          <Field label="Answer type" hint={question ? "Changing the type of a question that has answers can make old answers read oddly." : undefined}>
            <Select value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value as QuestionType })}>
              {QUESTION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          {hasOptions && (
            <Field label="Options" hint="One per line.">
              <Textarea required rows={5} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
            </Field>
          )}
          {q.type === "scale" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lowest"><Input type="number" value={q.scale?.min ?? 1} onChange={(e) => setQ({ ...q, scale: { ...q.scale!, min: Number(e.target.value) } })} /></Field>
              <Field label="Highest"><Input type="number" value={q.scale?.max ?? 5} onChange={(e) => setQ({ ...q, scale: { ...q.scale!, max: Number(e.target.value) } })} /></Field>
              <Field label="Label for lowest"><Input value={q.scale?.minLabel ?? ""} onChange={(e) => setQ({ ...q, scale: { ...q.scale!, minLabel: e.target.value || undefined } })} /></Field>
              <Field label="Label for highest"><Input value={q.scale?.maxLabel ?? ""} onChange={(e) => setQ({ ...q, scale: { ...q.scale!, maxLabel: e.target.value || undefined } })} /></Field>
            </div>
          )}
          {question && <Checkbox label="Archived (hidden from new questionnaires, old answers kept)" checked={q.archived} onChange={(e) => setQ({ ...q, archived: e.target.checked })} />}
          <MutationError error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>Save</Button>
            <Button variant="outline" onClick={onDone}>Cancel</Button>
          </div>
        </form>
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium text-muted-foreground">Preview ({humanise(q.type)})</p>
          {q.text ? <QuestionInput question={preview} value={undefined} onChange={() => {}} /> : <p className="text-sm text-muted-foreground">Type a question to see it here.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
