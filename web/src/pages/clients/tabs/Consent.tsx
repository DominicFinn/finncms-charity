import { CONSENT_PURPOSES, type Client, type ConsentMethod, type ConsentPurpose, type ConsentRecord } from "@ccm/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Can } from "@/components/RequirePermission";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useNameLookup, useOp, useOpMutation } from "@/hooks/api";
import { formatDateTime, fromLocalInput, humanise, toLocalInput } from "@/lib/format";

const INVALIDATES = ["consents.list", "clients.get", "clients.list"] as const;

export function ConsentTab({ client }: { client: Client }) {
  const list = useOp("consents.list", { clientId: client.id });
  const name = useNameLookup();
  return (
    <div className="flex flex-col gap-4">
      {client.status !== "anonymised" && (
        <Can need="consent.manage">
          <RecordConsentDialog clientId={client.id} />
        </Can>
      )}
      <QueryView query={list}>
        {(items) =>
          items.length ? (
            <ul className="flex flex-col gap-2">
              {items.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {CONSENT_PURPOSES[c.purpose]}
                      {c.withdrawnAt ? <Badge variant="destructive">Withdrawn</Badge> : <Badge variant="success">Given</Badge>}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {humanise(c.method)} consent given {formatDateTime(c.givenAt)}, recorded by {name(c.recordedBy)}
                    </span>
                    {c.notes && <span className="text-sm">{c.notes}</span>}
                    {c.withdrawnAt && (
                      <span className="text-sm text-muted-foreground">
                        Withdrawn {formatDateTime(c.withdrawnAt)}, recorded by {name(c.withdrawnBy)}
                        {c.withdrawalNotes && `: ${c.withdrawalNotes}`}
                      </span>
                    )}
                  </div>
                  {!c.withdrawnAt && client.status !== "anonymised" && (
                    <Can need="consent.manage">
                      <WithdrawDialog consent={c} />
                    </Can>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No consent recorded.</Empty>
          )
        }
      </QueryView>
    </div>
  );
}

function RecordConsentDialog({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState<ConsentPurpose>("data_processing");
  const [method, setMethod] = useState<ConsentMethod>("verbal");
  const [givenAt, setGivenAt] = useState(toLocalInput());
  const [notes, setNotes] = useState("");
  const record = useOpMutation("consents.record", [...INVALIDATES]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setGivenAt(toLocalInput());
          record.reset();
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button className="self-start">
          <Plus /> Record consent
        </Button>
      </DialogTrigger>
      <DialogContent title="Record consent">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            record.mutate(
              { clientId, purpose, method, givenAt: fromLocalInput(givenAt), notes: notes || undefined },
              { onSuccess: () => { setOpen(false); setNotes(""); } },
            );
          }}
        >
          <Field label="What they consented to">
            <Select value={purpose} onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}>
              {Object.entries(CONSENT_PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="How">
            <Select value={method} onChange={(e) => setMethod(e.target.value as ConsentMethod)}>
              <option value="verbal">Verbal</option>
              <option value="written">Written</option>
              <option value="electronic">Electronic</option>
            </Select>
          </Field>
          <Field label="When">
            <Input type="datetime-local" required value={givenAt} onChange={(e) => setGivenAt(e.target.value)} />
          </Field>
          <Field label="Notes" hint="Optional. For example, who was present.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <MutationError error={record.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={record.isPending}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({ consent }: { consent: ConsentRecord }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const withdraw = useOpMutation("consents.withdraw", [...INVALIDATES]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Withdraw</Button>
      </DialogTrigger>
      <DialogContent
        title="Record withdrawal of consent"
        description={`${CONSENT_PURPOSES[consent.purpose]}. The matching restriction will apply to this client straight away.`}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            withdraw.mutate({ id: consent.id, notes: notes || undefined }, { onSuccess: () => setOpen(false) });
          }}
        >
          <Field label="Notes" hint="Optional.">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <MutationError error={withdraw.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={withdraw.isPending}>Record withdrawal</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
