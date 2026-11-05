import {
  SAFEGUARDING_SEVERITIES,
  SAFEGUARDING_STATUSES,
  type SafeguardingConcern,
  type SafeguardingSeverity,
  type SafeguardingStatus,
} from "@ccm/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useNameLookup, useOpMutation } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { formatDateTime, humanise } from "@/lib/format";
import { Field } from "./Field";
import { MutationError } from "./States";
import { UserSelect } from "./UserSelect";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Select, Textarea } from "./ui/input";

const severityVariant: Record<SafeguardingSeverity, "outline" | "secondary" | "warning" | "destructive"> = {
  low: "outline",
  medium: "secondary",
  high: "warning",
  critical: "destructive",
};

export function SeverityBadge({ severity }: { severity: SafeguardingSeverity }) {
  return <Badge variant={severityVariant[severity]}>{humanise(severity)}</Badge>;
}

export function ConcernCard({ concern: c, showClient }: { concern: SafeguardingConcern; showClient?: boolean }) {
  const { can } = useAuth();
  const name = useNameLookup();
  const [managing, setManaging] = useState(false);
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={c.severity} />
          <Badge variant={c.status === "closed" ? "outline" : "default"}>{humanise(c.status)}</Badge>
          {showClient && (
            <Link to={`/clients/${c.clientId}/safeguarding`} className="text-sm font-medium underline-offset-4 hover:underline">
              Open client record
            </Link>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Raised {formatDateTime(c.raisedAt)} by {name(c.raisedBy)}
          {c.leadUid && ` · Lead: ${name(c.leadUid)}`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="whitespace-pre-wrap">{c.description}</p>
        <details>
          <summary className="cursor-pointer text-sm font-medium">History ({c.history.length})</summary>
          <ol className="mt-2 flex flex-col gap-2 border-l-2 pl-4">
            {c.history.map((h, i) => (
              <li key={i} className="text-sm">
                <span className="text-muted-foreground">{formatDateTime(h.at)} · {name(h.by)}: </span>
                {h.kind === "raised" && "Raised the concern"}
                {h.kind === "status_changed" && `Changed status to ${humanise(h.status ?? "")}`}
                {h.kind === "assigned" && `Assigned to ${name(h.leadUid)}`}
                {h.comment && <p className="whitespace-pre-wrap">{h.comment}</p>}
              </li>
            ))}
          </ol>
        </details>
        {can("safeguarding.manage") &&
          (managing ? <ManageConcern concern={c} onDone={() => setManaging(false)} /> : (
            <Button variant="outline" size="sm" className="self-start" onClick={() => setManaging(true)}>Update</Button>
          ))}
      </CardContent>
    </Card>
  );
}

function ManageConcern({ concern: c, onDone }: { concern: SafeguardingConcern; onDone: () => void }) {
  const [status, setStatus] = useState<SafeguardingStatus>(c.status);
  const [severity, setSeverity] = useState<SafeguardingSeverity>(c.severity);
  const [leadUid, setLeadUid] = useState(c.leadUid ?? "");
  const [comment, setComment] = useState("");
  const update = useOpMutation("safeguarding.update", ["safeguarding.list", "clients.get", "clients.list", "dashboard.get"]);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          {
            id: c.id,
            status: status !== c.status ? status : undefined,
            severity: severity !== c.severity ? severity : undefined,
            leadUid: leadUid && leadUid !== c.leadUid ? leadUid : undefined,
            comment: comment.trim() || undefined,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as SafeguardingStatus)}>
            {SAFEGUARDING_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </Select>
        </Field>
        <Field label="Severity">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as SafeguardingSeverity)}>
            {SAFEGUARDING_SEVERITIES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </Select>
        </Field>
        <Field label="Safeguarding lead">
          <UserSelect value={leadUid} onChange={(e) => setLeadUid(e.target.value)} emptyLabel="Not assigned" />
        </Field>
      </div>
      <Field label="Comment">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
      </Field>
      <MutationError error={update.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>Save</Button>
        <Button size="sm" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
