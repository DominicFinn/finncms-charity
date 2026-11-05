import type { PossibleDuplicate, Referral } from "@ccm/shared";
import { ArrowLeft, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChipPicker } from "@/components/ChipPicker";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Can } from "@/components/RequirePermission";
import { MutationError, QueryView } from "@/components/States";
import { UserSelect } from "@/components/UserSelect";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select, Textarea } from "@/components/ui/input";
import { useHelpCategories, useNameLookup, useOp, useOpMutation } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { formatDateTime, humanise } from "@/lib/format";
import { REFERRER_LABEL, ReferralStatusBadge } from "./Referrals";

const REFRESH = ["referrals.list", "referrals.get", "dashboard.get"] as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === undefined || children === null || children === "") return null;
  return (
    <div className="grid gap-0.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

export function ReferralDetailPage() {
  const { id = "" } = useParams();
  const q = useOp("referrals.get", { id });
  return (
    <>
      <Button variant="link" asChild className="mb-2 px-0">
        <Link to="/referrals"><ArrowLeft /> All referrals</Link>
      </Button>
      <QueryView query={q}>{(d) => <ReferralView referral={d.referral} duplicates={d.possibleDuplicates} />}</QueryView>
    </>
  );
}

function ReferralView({ referral: r, duplicates }: { referral: Referral; duplicates: PossibleDuplicate[] }) {
  const name = useNameLookup();
  const { can } = useAuth();
  const open = (r.status === "new" || r.status === "contacted") && !r.anonymisedAt;
  const title = r.anonymisedAt ? "Anonymised referral" : `${r.firstName} ${r.lastName}`;
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{title} <ReferralStatusBadge status={r.status} /></span>}
        description={`${r.reference} · ${REFERRER_LABEL[r.referrerType]} via ${r.source} · received ${formatDateTime(r.createdAt)}`}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          {r.anonymisedAt && (
            <Alert variant="info">The personal details on this referral were removed on {formatDateTime(r.anonymisedAt)} under the retention policy.</Alert>
          )}
          {open && duplicates.length > 0 && (
            <Alert variant="warning">
              <Users aria-hidden />
              <div className="flex flex-col gap-1">
                <strong>This might be someone already on the system.</strong>
                <ul className="list-disc pl-5">
                  {duplicates.map((d) => (
                    <li key={d.clientId}>
                      <Link to={`/clients/${d.clientId}`} className="underline underline-offset-4">{d.displayName}</Link>
                      {(d.town || d.postcodeDistrict) && `, ${[d.town, d.postcodeDistrict].filter(Boolean).join(" ")}`} ({d.reason})
                    </li>
                  ))}
                </ul>
                <span>You can link the referral to them when you accept it.</span>
              </div>
            </Alert>
          )}
          {r.status === "accepted" && r.clientId && (
            <Alert variant="info">
              Accepted {r.decidedAt && formatDateTime(r.decidedAt)}{r.decidedBy && ` by ${name(r.decidedBy)}`}.{" "}
              <Link to={`/clients/${r.clientId}`} className="font-medium underline underline-offset-4">Open the client record</Link>
            </Alert>
          )}
          {r.status === "declined" && (
            <Alert variant="default">
              Declined {r.decidedAt && formatDateTime(r.decidedAt)}{r.decidedBy && ` by ${name(r.decidedBy)}`}
              {r.declineReason && `: ${r.declineReason}`}
            </Alert>
          )}

          {!r.anonymisedAt && (
            <>
              <Card>
                <CardHeader><CardTitle>The person referred</CardTitle></CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-3">
                    <Row label="Name">{`${r.firstName} ${r.lastName}`}</Row>
                    <Row label="Address">{[r.addressLine, r.town, r.postcode].filter(Boolean).join(", ")}</Row>
                    <Row label="Phone">{r.phone}</Row>
                    <Row label="Email">{r.email}</Row>
                    <Row label="Best way to contact">{r.preferredContactMethod && humanise(r.preferredContactMethod)}</Row>
                    <Row label="Knows about the referral">{r.personAware ? "Yes" : "Not confirmed"}</Row>
                    <Row label="Agreed to be contacted">{r.consentToContact ? "Yes" : "No"}</Row>
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Help needed</CardTitle></CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="whitespace-pre-wrap">{r.helpNeeded}</p>
                  {r.helpCategoryHints.length > 0 && <p className="text-sm text-muted-foreground">Areas ticked: {r.helpCategoryHints.join(", ")}</p>}
                </CardContent>
              </Card>
              {r.referrerType !== "self" && (
                <Card>
                  <CardHeader><CardTitle>Who referred them</CardTitle></CardHeader>
                  <CardContent>
                    <dl className="flex flex-col gap-3">
                      <Row label="Name">{r.referrerName}</Row>
                      <Row label="Relationship">{r.referrerRelationship}</Row>
                      <Row label="Organisation">{r.referrerOrganisation}</Row>
                      <Row label="Phone">{r.referrerPhone}</Row>
                      <Row label="Email">{r.referrerEmail}</Row>
                    </dl>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle>Where it came from</CardTitle></CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-3">
                    <Row label="Source">{r.source}</Row>
                    <Row label="Heard about us">{r.heardAbout}</Row>
                    <Row label="Page">{r.sourceUrl}</Row>
                  </dl>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {open ? (
            <Can need="referrals.manage">
              <TriageCard referral={r} />
              <Card>
                <CardHeader><CardTitle>Decision</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <AcceptDialog referral={r} duplicates={duplicates} />
                  <DeclineDialog referral={r} />
                </CardContent>
              </Card>
            </Can>
          ) : (
            r.notes && (
              <Card>
                <CardHeader><CardTitle>Triage notes</CardTitle></CardHeader>
                <CardContent><p className="whitespace-pre-wrap">{r.notes}</p></CardContent>
              </Card>
            )
          )}
          {open && r.assigneeUid && !can("referrals.manage") && <p className="text-sm">With {name(r.assigneeUid)}</p>}
        </div>
      </div>
    </>
  );
}

function TriageCard({ referral: r }: { referral: Referral }) {
  const [status, setStatus] = useState(r.status as "new" | "contacted");
  const [assignee, setAssignee] = useState(r.assigneeUid ?? "");
  const [notes, setNotes] = useState(r.notes ?? "");
  const [saved, setSaved] = useState(false);
  const update = useOpMutation("referrals.update", [...REFRESH]);
  return (
    <Card>
      <CardHeader><CardTitle>Triage</CardTitle></CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            update.mutate({ id: r.id, status, assigneeUid: assignee, notes }, { onSuccess: () => setSaved(true) });
          }}
        >
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as "new" | "contacted")}>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
            </Select>
          </Field>
          <Field label="Assigned to">
            <UserSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} emptyLabel="Nobody yet" />
          </Field>
          <Field label="Notes" hint="Calls made, what was agreed. Added to the client's notes if accepted.">
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
          </Field>
          <MutationError error={update.error} />
          {saved && !update.isPending && <p className="text-sm text-muted-foreground" role="status">Saved.</p>}
          <Button type="submit" className="self-start" disabled={update.isPending}>Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AcceptDialog({ referral: r, duplicates }: { referral: Referral; duplicates: PossibleDuplicate[] }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [linkTo, setLinkTo] = useState(duplicates[0]?.clientId && !can("clients.create") ? duplicates[0].clientId : "");
  const [categories, setCategories] = useState<string[]>([]);
  const cats = useHelpCategories();
  const accept = useOpMutation("referrals.accept", [...REFRESH, "clients.list"]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Accept</Button>
      </DialogTrigger>
      <DialogContent title="Accept this referral" description="The referral details are added to the client's notes. The referral itself is kept for counting, and its personal details are removed after the retention period.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            accept.mutate(
              { id: r.id, existingClientId: linkTo || undefined, helpCategoryIds: linkTo ? [] : categories },
              { onSuccess: (res) => navigate(`/clients/${res.clientId}`) },
            );
          }}
        >
          {duplicates.length > 0 && (
            <Field label="Client record">
              <Select value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                {can("clients.create") && <option value="">Create a new client</option>}
                {duplicates.map((d) => (
                  <option key={d.clientId} value={d.clientId}>Link to {d.displayName} ({d.reason})</option>
                ))}
              </Select>
            </Field>
          )}
          {!linkTo && (
            <ChipPicker
              label="Help categories"
              options={(cats.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
              value={categories}
              onChange={setCategories}
            />
          )}
          {!linkTo && !can("clients.create") && <Alert variant="warning">You need permission to create clients to accept this as a new client.</Alert>}
          <MutationError error={accept.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={accept.isPending || (!linkTo && !can("clients.create"))}>
              {linkTo ? "Link and accept" : "Create client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ referral: r }: { referral: Referral }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const decline = useOpMutation("referrals.decline", [...REFRESH]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Decline</Button>
      </DialogTrigger>
      <DialogContent title="Decline this referral" description="Say why, for example outside our area or referred on to another service. If you can, let the person or referrer know.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            decline.mutate({ id: r.id, reason }, { onSuccess: () => setOpen(false) });
          }}
        >
          <Field label="Reason">
            <Textarea required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <MutationError error={decline.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={decline.isPending || !reason.trim()}>Decline</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
