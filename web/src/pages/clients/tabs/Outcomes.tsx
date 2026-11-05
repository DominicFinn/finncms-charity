import type { Client, OutcomePerspective } from "@ccm/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AnswerForm, AnswerList, questionsFor } from "@/components/AnswerForm";
import { Field } from "@/components/Field";
import { Can } from "@/components/RequirePermission";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useHelpCategories, useNameLookup, useOp, useOpMutation, useQuestions, useQuestionSets } from "@/hooks/api";
import { formatDateTime } from "@/lib/format";

export function OutcomesTab({ client }: { client: Client }) {
  const list = useOp("outcomes.list", { clientId: client.id });
  const sets = useQuestionSets("outcome", true);
  const questions = useQuestions(true);
  const cats = useHelpCategories(true);
  const name = useNameLookup();
  const [recording, setRecording] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {client.status === "active" && !recording && (
        <Can need="outcomes.record">
          <Button className="self-start" onClick={() => setRecording(true)}><Plus /> Record an outcome</Button>
        </Can>
      )}
      {recording && <RecordOutcome client={client} onDone={() => setRecording(false)} />}
      <QueryView query={list}>
        {(items) =>
          items.length ? (
            <div className="flex flex-col gap-3">
              {items.map((o) => {
                const set = sets.data?.find((s) => s.id === o.setId);
                return (
                  <Card key={o.id}>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {set?.name ?? "Outcome"}
                        <Badge variant="outline">{o.perspective === "client" ? "Client's view" : "Staff view"}</Badge>
                        <Badge>{cats.data?.find((c) => c.id === o.helpCategoryId)?.name ?? "Category"}</Badge>
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">{formatDateTime(o.recordedAt)} · {name(o.recordedBy)}</p>
                    </CardHeader>
                    <CardContent>
                      <AnswerList questions={questionsFor(set?.questionIds ?? Object.keys(o.answers), questions.data)} answers={o.answers} />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Empty>No outcomes recorded yet.</Empty>
          )
        }
      </QueryView>
    </div>
  );
}

function RecordOutcome({ client, onDone }: { client: Client; onDone: () => void }) {
  const sets = useQuestionSets("outcome");
  // Archived questions included: a measure may still list one, and dropping it would lose that question.
  const questions = useQuestions(true);
  const cats = useHelpCategories();
  const sessions = useOp("sessions.list", { clientId: client.id, limit: 50 });
  const record = useOpMutation("outcomes.record", ["outcomes.list", "reports.outcomes", "clients.get", "clients.list", "retention.upcoming"]);
  const [setId, setSetId] = useState("");
  const [helpCategoryId, setHelpCategoryId] = useState(client.helpCategoryIds[0] ?? "");
  const [sessionId, setSessionId] = useState("");
  const [perspective, setPerspective] = useState<OutcomePerspective>("client");
  const set = sets.data?.find((s) => s.id === setId);

  return (
    <Card>
      <CardHeader><CardTitle>Record an outcome</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Outcome measure">
            <Select required value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">Choose one</option>
              {sets.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Help category">
            <Select required value={helpCategoryId} onChange={(e) => setHelpCategoryId(e.target.value)}>
              <option value="">Choose one</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Session" hint="Optional.">
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">None</option>
              {sessions.data?.map((s) => <option key={s.id} value={s.id}>{formatDateTime(s.startsAt)}</option>)}
            </Select>
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Whose view is this?</legend>
            <div className="flex gap-2">
              {(["client", "staff"] as const).map((p) => (
                <label key={p} className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
                  <input type="radio" name="perspective" checked={perspective === p} onChange={() => setPerspective(p)} className="size-5 accent-[var(--primary)]" />
                  {p === "client" ? "The client's" : "Staff"}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {set && helpCategoryId ? (
          <AnswerForm
            key={set.id}
            questions={questionsFor(set.questionIds, questions.data)}
            busy={record.isPending}
            saveLabel="Record outcome"
            onCancel={onDone}
            onSave={(answers) =>
              record.mutate(
                { clientId: client.id, setId: set.id, helpCategoryId, sessionId: sessionId || undefined, perspective, answers },
                { onSuccess: onDone },
              )
            }
          />
        ) : (
          <div className="flex gap-2">
            <p className="flex-1 text-sm text-muted-foreground">Choose a measure and a help category to see the questions.</p>
            <Button variant="outline" onClick={onDone}>Cancel</Button>
          </div>
        )}
        <MutationError error={record.error} />
      </CardContent>
    </Card>
  );
}
