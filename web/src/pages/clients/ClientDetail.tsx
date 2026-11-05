import { clientDisplayName, type Client } from "@ccm/shared";
import { Download, Pencil, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Can } from "@/components/RequirePermission";
import { MutationError, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOp, useOpMutation } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { api } from "@/lib/api";
import { humanise } from "@/lib/format";
import type { PermissionRequirement } from "@/lib/permissions";
import { downloadFile } from "@/lib/utils";
import { AccessLogTab } from "./tabs/AccessLog";
import { CallbacksTab } from "./tabs/Callbacks";
import { ConsentTab } from "./tabs/Consent";
import { NotesFilesTab } from "./tabs/NotesFiles";
import { OutcomesTab } from "./tabs/Outcomes";
import { OverviewTab } from "./tabs/Overview";
import { QuestionnairesTab } from "./tabs/Questionnaires";
import { SafeguardingTab } from "./tabs/Safeguarding";
import { SessionsTab } from "./tabs/Sessions";

const TABS: { id: string; label: string; need?: PermissionRequirement; render: (c: Client) => React.ReactNode }[] = [
  { id: "overview", label: "Overview", render: (c) => <OverviewTab client={c} /> },
  { id: "questionnaires", label: "Questionnaires", render: (c) => <QuestionnairesTab client={c} /> },
  { id: "sessions", label: "Sessions", render: (c) => <SessionsTab client={c} /> },
  { id: "callbacks", label: "Callbacks", render: (c) => <CallbacksTab client={c} /> },
  { id: "notes", label: "Notes and files", render: (c) => <NotesFilesTab client={c} /> },
  { id: "outcomes", label: "Outcomes", render: (c) => <OutcomesTab client={c} /> },
  { id: "consent", label: "Consent", render: (c) => <ConsentTab client={c} /> },
  { id: "safeguarding", label: "Safeguarding", need: { any: ["safeguarding.view", "safeguarding.raise"] }, render: (c) => <SafeguardingTab client={c} /> },
  { id: "access", label: "Access log", need: { any: ["audit.view", "safeguarding.manage"] }, render: (c) => <AccessLogTab client={c} /> },
];

export function ClientDetailPage() {
  const { id = "", tab = "overview" } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const client = useOp("clients.get", { id });
  const tabs = TABS.filter((t) => can(t.need));

  return (
    <QueryView query={client}>
      {(c) => {
        const anonymised = c.status === "anonymised";
        return (
          <>
            <PageHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {anonymised ? "Anonymised client" : clientDisplayName(c)}
                  {c.status !== "active" && <Badge variant="outline">{humanise(c.status)}</Badge>}
                </span>
              }
              description={!anonymised && c.preferredName ? `${c.firstName} ${c.lastName}` : undefined}
              actions={
                !anonymised && (
                  <>
                    <Can need="clients.edit">
                      <Button variant="outline" asChild>
                        <Link to={`/clients/${c.id}/edit`}><Pencil /> Edit</Link>
                      </Button>
                    </Can>
                    <Can need="clients.export">
                      <ExportButton client={c} />
                    </Can>
                    <Can need="clients.anonymise">
                      <AnonymiseDialog client={c} />
                    </Can>
                  </>
                )
              }
            />

            {!!c.openSafeguardingConcerns && (
              <Alert variant="destructive" className="mb-4">
                <ShieldAlert aria-hidden />
                <div>
                  This client has {c.openSafeguardingConcerns} open safeguarding {c.openSafeguardingConcerns === 1 ? "concern" : "concerns"}.{" "}
                  <Link to={`/clients/${c.id}/safeguarding`} className="font-medium underline">See concerns</Link>
                </div>
              </Alert>
            )}
            {anonymised && (
              <Alert variant="info" className="mb-4">
                This client has been anonymised. Personal details, notes and files were removed. Anonymous figures are kept for reporting.
              </Alert>
            )}

            <Tabs value={tabs.some((t) => t.id === tab) ? tab : "overview"} onValueChange={(v) => nav(`/clients/${c.id}/${v}`, { replace: true })}>
              <TabsList aria-label="Client record sections">
                {tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
              </TabsList>
              {tabs.map((t) => (
                <TabsContent key={t.id} value={t.id}>{t.render(c)}</TabsContent>
              ))}
            </Tabs>
          </>
        );
      }}
    </QueryView>
  );
}

function ExportButton({ client }: { client: Client }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        title="Export everything held on this client, for a subject access request"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const data = await api("clients.export", { id: client.id });
            const stamp = new Date().toISOString().slice(0, 10);
            downloadFile(`client-${client.id}-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download /> Export
      </Button>
      {!!error && <MutationError error={error} />}
    </>
  );
}

type Basis = "erasure_request" | "no_longer_needed";

function AnonymiseDialog({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [basis, setBasis] = useState<Basis | "">("");
  const anonymise = useOpMutation("clients.anonymise", ["clients.get", "clients.list", "retention.upcoming", "dashboard.get"]);
  const expected = `${client.firstName} ${client.lastName}`;
  const matches = typed.trim().toLowerCase() === expected.toLowerCase();
  const blocked = !!client.openSafeguardingConcerns;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setTyped("");
        setBasis("");
        anonymise.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive"><Trash2 /> Anonymise</Button>
      </DialogTrigger>
      <DialogContent
        title="Anonymise this client"
        description="This removes their personal details, contacts, notes, files and free text answers. It can't be undone. Outcome results, help categories and session counts are kept without anything that identifies them."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!matches || !basis) return;
            anonymise.mutate({ id: client.id, basis }, { onSuccess: () => setOpen(false) });
          }}
        >
          {blocked && (
            <Alert variant="warning">
              This client has an open safeguarding concern. They can't be anonymised until it's closed.
            </Alert>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Why is this being done?</legend>
            {(
              [
                ["erasure_request", "Client asked for their data to be erased"],
                ["no_longer_needed", "We no longer need the data"],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm">
                <input type="radio" name="basis" value={v} checked={basis === v} onChange={() => setBasis(v)} className="size-5 accent-[var(--primary)]" />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-name">Type <strong>{expected}</strong> to confirm</Label>
            <Input id="confirm-name" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <MutationError error={anonymise.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!matches || !basis || blocked || anonymise.isPending}>
              Anonymise permanently
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
