import type { Client, QuestionSet } from "@ccm/shared";
import { History, Lock, Pencil, X } from "lucide-react";
import { useState } from "react";
import { AnswerForm, AnswerList, questionsFor } from "@/components/AnswerForm";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Empty, Loading, MutationError, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useNameLookup, useOp, useOpMutation, useQuestions, useQuestionSets } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { formatDateTime } from "@/lib/format";

export function QuestionnairesTab({ client }: { client: Client }) {
  const { can } = useAuth();
  const sets = useQuestionSets("questionnaire");
  const attach = useOpMutation("clients.setQuestionSet", ["clients.get"]);
  const [adding, setAdding] = useState("");
  const canSensitive = can("questionnaires.viewSensitive") && !client.restrictions.includes("no_sensitive_data");
  const editable = client.status === "active" && can("clients.edit");

  return (
    <QueryView query={sets}>
      {(all) => {
        const visible = (s: QuestionSet) => !s.sensitive || canSensitive;
        const attached = client.questionSetIds.map((id) => all.find((s) => s.id === id)).filter((s): s is QuestionSet => !!s);
        const hiddenCount = attached.filter((s) => !visible(s)).length;
        const available = all.filter((s) => !client.questionSetIds.includes(s.id) && visible(s));
        return (
          <div className="flex flex-col gap-4">
            {editable && available.length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="attach-set" className="text-sm font-medium">Add a questionnaire</label>
                  <Select id="attach-set" value={adding} onChange={(e) => setAdding(e.target.value)} className="min-w-56">
                    <option value="">Choose one</option>
                    {available.map((s) => <option key={s.id} value={s.id}>{s.name}{s.sensitive ? " (sensitive)" : ""}</option>)}
                  </Select>
                </div>
                <Button
                  disabled={!adding || attach.isPending}
                  onClick={() => attach.mutate({ clientId: client.id, setId: adding, attached: true }, { onSuccess: () => setAdding("") })}
                >
                  Add
                </Button>
              </div>
            )}
            <MutationError error={attach.error} />
            {hiddenCount > 0 && (
              <Alert variant="info">
                <Lock aria-hidden />
                <div>{hiddenCount} sensitive {hiddenCount === 1 ? "questionnaire is" : "questionnaires are"} hidden from you.</div>
              </Alert>
            )}
            {attached.filter(visible).length === 0 ? (
              <Empty>No questionnaires attached.</Empty>
            ) : (
              attached.filter(visible).map((s) => (
                <SetCard
                  key={s.id}
                  client={client}
                  set={s}
                  editable={editable}
                  onDetach={() => attach.mutate({ clientId: client.id, setId: s.id, attached: false })}
                />
              ))
            )}
          </div>
        );
      }}
    </QueryView>
  );
}

function SetCard({ client, set, editable, onDetach }: { client: Client; set: QuestionSet; editable: boolean; onDetach: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const questions = useQuestions(true);
  const answers = useOp("answers.get", { clientId: client.id, setId: set.id, includeHistory: showHistory });
  const save = useOpMutation("answers.save", ["answers.get", "clients.get"]);
  const name = useNameLookup();
  const qs = questionsFor(set.questionIds, questions.data);
  const current = answers.data?.current;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            {set.name} {set.sensitive && <Badge variant="warning"><Lock className="size-3" aria-hidden /> Sensitive</Badge>}
          </CardTitle>
          <CardDescription>
            {current ? `Version ${current.version}, updated ${formatDateTime(current.recordedAt)} by ${name(current.recordedBy)}` : "Not answered yet"}
          </CardDescription>
        </div>
        {editable && !editing && (
          <div className="flex shrink-0 gap-1">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> {current ? "Update" : "Answer"}</Button>
            <ConfirmDialog
              trigger={<Button variant="ghost" size="sm" aria-label={`Remove ${set.name}`}><X /></Button>}
              title={`Remove ${set.name}?`}
              description="It will no longer show on this client's record. Answers already given are kept and come back if you add it again."
              confirmLabel="Remove"
              onConfirm={onDetach}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {answers.isLoading || questions.isLoading ? (
          <Loading />
        ) : editing ? (
          <>
            <AnswerForm
              questions={qs}
              initial={current?.answers}
              busy={save.isPending}
              onCancel={() => setEditing(false)}
              onSave={(a) => save.mutate({ clientId: client.id, setId: set.id, answers: a }, { onSuccess: () => setEditing(false) })}
            />
            <MutationError error={save.error} />
          </>
        ) : current ? (
          <AnswerList questions={qs} answers={current.answers} />
        ) : null}

        {current && current.version > 1 && (
          <Button variant="link" className="self-start px-0" onClick={() => setShowHistory(!showHistory)}>
            <History /> {showHistory ? "Hide earlier versions" : "Show earlier versions"}
          </Button>
        )}
        {showHistory &&
          answers.data?.history
            .filter((h) => h.version !== current?.version)
            .map((h) => (
              <details key={h.id} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm">
                  Version {h.version}, {formatDateTime(h.recordedAt)} by {name(h.recordedBy)}
                </summary>
                <AnswerList questions={qs} answers={h.answers} />
              </details>
            ))}
      </CardContent>
    </Card>
  );
}
