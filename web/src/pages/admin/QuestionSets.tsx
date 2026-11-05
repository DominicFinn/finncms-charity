import type { QuestionSet, QuestionSetKind } from "@ccm/shared";
import { ArrowDown, ArrowUp, Lock, Plus, X } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { useOpMutation, useQuestions, useQuestionSets } from "@/hooks/api";

export function QuestionSetsAdmin() {
  const [showArchived, setShowArchived] = useState(false);
  const sets = useQuestionSets(undefined, showArchived);
  const questions = useQuestions(true);
  const [editing, setEditing] = useState<QuestionSet | "new" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        Questionnaires are attached to clients. Outcome measures are recorded against a help category to show whether help made a difference.
      </p>
      {editing ? (
        <SetEditor set={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setEditing("new")}><Plus /> New set</Button>
          <Checkbox label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        </div>
      )}
      <QueryView query={sets}>
        {(list) =>
          list.length ? (
            <div className="flex flex-col gap-3">
              {list.map((s) => (
                <Card key={s.id}>
                  <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {s.name}
                        <Badge variant="outline">{s.kind === "outcome" ? "Outcome measure" : "Questionnaire"}</Badge>
                        {s.sensitive && <Badge variant="warning"><Lock className="size-3" aria-hidden /> Sensitive</Badge>}
                        {s.attachByDefault && <Badge variant="secondary">Added to new clients</Badge>}
                        {s.archived && <Badge variant="secondary">Archived</Badge>}
                      </CardTitle>
                      {s.description && <CardDescription>{s.description}</CardDescription>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEditing(s)}>Edit</Button>
                  </CardHeader>
                  <CardContent>
                    <ol className="list-decimal pl-5 text-sm">
                      {s.questionIds.map((id) => <li key={id}>{questions.data?.find((q) => q.id === id)?.text ?? "Missing question"}</li>)}
                    </ol>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Empty>No sets yet.</Empty>
          )
        }
      </QueryView>
    </div>
  );
}

function SetEditor({ set, onDone }: { set?: QuestionSet; onDone: () => void }) {
  const questions = useQuestions();
  const allQuestions = useQuestions(true);
  const save = useOpMutation("questionSets.upsert", ["questionSets.list"]);
  const [s, setS] = useState<Omit<QuestionSet, "id">>(
    set ?? { name: "", description: "", kind: "questionnaire", sensitive: false, questionIds: [], attachByDefault: false, archived: false },
  );
  const [adding, setAdding] = useState("");
  const move = (i: number, d: -1 | 1) => {
    const ids = [...s.questionIds];
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    setS({ ...s, questionIds: ids });
  };
  const textOf = (id: string) => allQuestions.data?.find((q) => q.id === id)?.text ?? "Missing question";

  return (
    <Card>
      <CardHeader><CardTitle>{set ? `Edit ${set.name}` : "New set"}</CardTitle></CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ id: set?.id, ...s, description: s.description || undefined }, { onSuccess: onDone });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
            <Field label="Kind">
              <Select value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value as QuestionSetKind })}>
                <option value="questionnaire">Questionnaire</option>
                <option value="outcome">Outcome measure</option>
              </Select>
            </Field>
          </div>
          <Field label="Description"><Textarea rows={2} value={s.description ?? ""} onChange={(e) => setS({ ...s, description: e.target.value })} /></Field>
          <Checkbox
            label="Sensitive (health, finance or similar). Only people allowed to see sensitive questionnaires can view or answer it."
            checked={s.sensitive}
            onChange={(e) => setS({ ...s, sensitive: e.target.checked })}
          />
          {s.kind === "questionnaire" && (
            <Checkbox label="Add to every new client" checked={s.attachByDefault} onChange={(e) => setS({ ...s, attachByDefault: e.target.checked })} />
          )}
          {set && <Checkbox label="Archived" checked={s.archived} onChange={(e) => setS({ ...s, archived: e.target.checked })} />}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Questions, in order</legend>
            {s.questionIds.length === 0 && <p className="text-sm text-muted-foreground">No questions yet.</p>}
            <ol className="flex flex-col gap-1">
              {s.questionIds.map((id, i) => (
                <li key={id} className="flex items-center gap-1 rounded-md border p-1 pl-3 text-sm">
                  <span className="flex-1">{i + 1}. {textOf(id)}</span>
                  <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === s.questionIds.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setS({ ...s, questionIds: s.questionIds.filter((x) => x !== id) })}><X /></Button>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Add a question" className="min-w-0 flex-1">
                <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Choose one</option>
                  {questions.data?.filter((q) => !s.questionIds.includes(q.id)).map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
                </Select>
              </Field>
              <Button variant="outline" disabled={!adding} onClick={() => { setS({ ...s, questionIds: [...s.questionIds, adding] }); setAdding(""); }}>
                Add
              </Button>
            </div>
          </fieldset>
          <MutationError error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>Save</Button>
            <Button variant="outline" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
