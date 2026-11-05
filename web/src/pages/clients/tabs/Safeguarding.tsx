import { SAFEGUARDING_SEVERITIES, type Client, type SafeguardingSeverity } from "@ccm/shared";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { ConcernCard } from "@/components/Concern";
import { Field } from "@/components/Field";
import { Can } from "@/components/RequirePermission";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select, Textarea } from "@/components/ui/input";
import { useOp, useOpMutation } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { humanise } from "@/lib/format";

export function SafeguardingTab({ client }: { client: Client }) {
  const { can } = useAuth();
  return (
    <div className="flex flex-col gap-4">
      {client.status !== "anonymised" && (
        <Can need="safeguarding.raise">
          <RaiseConcernDialog clientId={client.id} />
        </Can>
      )}
      {can("safeguarding.view") ? (
        <ConcernList clientId={client.id} />
      ) : (
        <Alert variant="info">Concerns you raise go to the safeguarding lead. You can't see existing concerns.</Alert>
      )}
    </div>
  );
}

function ConcernList({ clientId }: { clientId: string }) {
  const list = useOp("safeguarding.list", { clientId, openOnly: false });
  return (
    <QueryView query={list}>
      {(items) =>
        items.length ? (
          <div className="flex flex-col gap-3">{items.map((c) => <ConcernCard key={c.id} concern={c} />)}</div>
        ) : (
          <Empty>No safeguarding concerns.</Empty>
        )
      }
    </QueryView>
  );
}

function RaiseConcernDialog({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<SafeguardingSeverity>("medium");
  const raise = useOpMutation("safeguarding.raise", ["safeguarding.list", "clients.get", "clients.list", "dashboard.get"]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) raise.reset();
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" className="self-start">
          <ShieldAlert /> Raise a concern
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Raise a safeguarding concern"
        description="Describe what you saw or were told, in plain facts. If someone is in immediate danger, call 999 first."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            raise.mutate({ clientId, description, severity }, { onSuccess: () => { setOpen(false); setDescription(""); } });
          }}
        >
          <Field label="What happened">
            <Textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
          </Field>
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as SafeguardingSeverity)}>
              {SAFEGUARDING_SEVERITIES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
            </Select>
          </Field>
          <MutationError error={raise.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={raise.isPending}>Raise concern</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
