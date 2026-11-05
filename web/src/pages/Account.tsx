import { Calendar, Check, Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Can } from "@/components/RequirePermission";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { useOp, useOpMutation } from "@/hooks/api";
import { useMe } from "@/hooks/auth";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";

export function AccountPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Your account" />
      <div className="flex max-w-3xl flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-center gap-4">
            {me.user.photoURL && <img src={me.user.photoURL} alt="" className="size-14 rounded-full" referrerPolicy="no-referrer" />}
            <div>
              <CardTitle>{me.user.displayName}</CardTitle>
              <CardDescription>{me.user.email}</CardDescription>
            </div>
          </CardHeader>
        </Card>
        {me.org.calendarSyncEnabled && <CalendarCard />}
        <Can need="mcp.use">
          <TokensCard />
        </Can>
      </div>
    </>
  );
}

function CalendarCard() {
  const me = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const disconnect = useOpMutation("calendar.disconnect");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Calendar className="size-5" aria-hidden /> Google Calendar</CardTitle>
        <CardDescription>
          Sessions and callbacks assigned to you appear in your calendar. Events show the client's initials and a link back here, nothing more.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {me.user.calendarConnected ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="success"><Check className="size-3" aria-hidden /> Connected</Badge>
            <Button
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate({}, { onSuccess: () => void qc.invalidateQueries({ queryKey: ["me.get"] }) })}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button
            className="self-start"
            onClick={async () => {
              setError(null);
              try {
                const { url } = await api("calendar.connectUrl", { returnTo: "/account" });
                window.location.assign(url);
              } catch (e) {
                setError(e);
              }
            }}
          >
            Connect Google Calendar
          </Button>
        )}
        <MutationError error={error ?? disconnect.error} />
      </CardContent>
    </Card>
  );
}

function TokensCard() {
  const list = useOp("tokens.list", {});
  const revoke = useOpMutation("tokens.revoke", ["tokens.list"]);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-5" aria-hidden /> Claude access tokens</CardTitle>
          <CardDescription>
            Tokens let Claude work with this system as you, through MCP. Claude can only see and do what you can, and everything it does is logged.
          </CardDescription>
        </div>
        <CreateTokenDialog />
      </CardHeader>
      <CardContent>
        <QueryView query={list}>
          {(tokens) =>
            tokens.length ? (
              <ul className="flex flex-col divide-y">
                {tokens.map((t) => {
                  const expired = new Date(t.expiresAt).getTime() < Date.now();
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="flex flex-col">
                        <span className="flex items-center gap-2 font-medium">
                          {t.name}
                          {t.revokedAt ? <Badge variant="outline">Revoked</Badge> : expired ? <Badge variant="outline">Expired</Badge> : <Badge variant="success">Active</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Created {formatDate(t.createdAt)} · expires {formatDate(t.expiresAt)}
                          {t.lastUsedAt && ` · last used ${formatDateTime(t.lastUsedAt)}`}
                        </span>
                      </div>
                      {!t.revokedAt && !expired && (
                        <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: t.id })}>
                          Revoke
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>No tokens yet.</Empty>
            )
          }
        </QueryView>
        <MutationError error={revoke.error} />
      </CardContent>
    </Card>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : label}
    </Button>
  );
}

function CreateTokenDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Claude");
  const [days, setDays] = useState(90);
  const [token, setToken] = useState<string | null>(null);
  const create = useOpMutation("tokens.create", ["tokens.list"]);
  const url = `${window.location.origin}/mcp`;
  const config = token
    ? JSON.stringify({ mcpServers: { charity: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
    : "";
  const cli = token ? `claude mcp add --transport http charity ${url} --header "Authorization: Bearer ${token}"` : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setToken(null);
          create.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button><Plus /> New token</Button>
      </DialogTrigger>
      <DialogContent title={token ? "Your new token" : "Create a token"}>
        {token ? (
          <div className="flex flex-col gap-4">
            <Alert variant="warning">Copy this now. It won't be shown again. Treat it like a password.</Alert>
            <div className="flex flex-col gap-2">
              <code className="rounded bg-muted p-2 text-sm break-all">{token}</code>
              <CopyButton text={token} label="Copy token" />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Claude Code</p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{cli}</pre>
              <CopyButton text={cli} label="Copy command" />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">MCP config (JSON)</p>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{config}</pre>
              <CopyButton text={config} label="Copy config" />
            </div>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name, expiresInDays: days }, { onSuccess: (r) => setToken(r.token) });
            }}
          >
            <Field label="Name" hint="So you can tell your tokens apart, for example 'Claude on my laptop'.">
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Expires after">
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </Select>
            </Field>
            <MutationError error={create.error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
