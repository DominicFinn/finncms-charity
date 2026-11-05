import { Check, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useNameLookup, useOp, useOpMutation } from "@/hooks/api";
import { formatDate, formatDateTime } from "@/lib/format";

export function IntegrationKeysAdmin() {
  const list = useOp("integrationKeys.list", {});
  const revoke = useOpMutation("integrationKeys.revoke", ["integrationKeys.list"]);
  const name = useNameLookup();
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Integration keys</CardTitle>
          <CardDescription>
            A key lets another system, such as the charity's website, send referrals here. Keep keys on servers only, never in web pages. Each key is
            limited to a number of referrals an hour.
          </CardDescription>
        </div>
        <CreateKeyDialog />
      </CardHeader>
      <CardContent>
        <QueryView query={list}>
          {(keys) =>
            keys.length ? (
              <ul className="flex flex-col divide-y">
                {keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        {k.name}
                        {k.revokedAt ? <Badge variant="outline">Revoked</Badge> : <Badge variant="success">Active</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Source "{k.source}" · up to {k.hourlyLimit} an hour · created {formatDate(k.createdAt)} by {name(k.createdBy)}
                        {k.lastUsedAt && ` · last used ${formatDateTime(k.lastUsedAt)}`}
                      </span>
                    </div>
                    {!k.revokedAt && (
                      <ConfirmDialog
                        trigger={<Button variant="outline" size="sm">Revoke</Button>}
                        title={`Revoke ${k.name}?`}
                        description="Referrals sent with this key will be refused straight away. This can't be undone; create a new key if you need one."
                        confirmLabel="Revoke"
                        destructive
                        onConfirm={() => revoke.mutateAsync({ id: k.id })}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No keys yet.</Empty>
            )
          }
        </QueryView>
        <MutationError error={revoke.error} />
      </CardContent>
    </Card>
  );
}

function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Website");
  const [source, setSource] = useState("Website");
  const [limit, setLimit] = useState(20);
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useOpMutation("integrationKeys.create", ["integrationKeys.list"]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setKey(null);
          setCopied(false);
          create.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button><Plus /> New key</Button>
      </DialogTrigger>
      <DialogContent title={key ? "Your new key" : "Create an integration key"}>
        {key ? (
          <div className="flex flex-col gap-4">
            <Alert variant="warning">Copy this now. It won't be shown again. Put it in the website's server settings as CONTACTS_API_KEY.</Alert>
            <code className="rounded bg-muted p-2 text-sm break-all">{key}</code>
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(key).then(() => setCopied(true))}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy key"}
            </Button>
            <p className="text-sm text-muted-foreground">Referrals are sent to {window.location.origin}/api/referrals</p>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name, source, hourlyLimit: limit }, { onSuccess: (r) => setKey(r.key) });
            }}
          >
            <Field label="Name" hint="For your reference, for example 'NDIE website'.">
              <Input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Source label" hint="Shown on every referral sent with this key.">
              <Input required maxLength={60} value={source} onChange={(e) => setSource(e.target.value)} />
            </Field>
            <Field label="Most referrals an hour" hint="Requests over this are refused until the next hour. Keep it low.">
              <Input type="number" min={1} max={1000} required value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </Field>
            <MutationError error={create.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
