import {
  ATTENDANCE_STATUSES,
  MEETING_TYPE_LABELS,
  type AgendaItem,
  type AttendanceStatus,
  type MeetingDetail,
  type MeetingGuest,
  type MeetingPaper,
} from "@ccm/shared";
import { ArrowDown, ArrowUp, CheckCircle2, Download, FileText, Pencil, Plus, Printer, RotateCcw, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDirectory, useNameLookup, useOp, useOpMutation } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, humanise } from "@/lib/format";
import { ActionDialog, ActionItem, MEETING_INVALIDATES, MeetingDialog, MinutesBadge } from "./parts";

export function MeetingDetailPage() {
  const { id = "" } = useParams();
  const detail = useOp("meetings.get", { id });
  return <QueryView query={detail}>{(d) => <MeetingView d={d} />}</QueryView>;
}

export function QuorumBadge({ quorum }: { quorum: MeetingDetail["quorum"] }) {
  const text = `${quorum.present} of ${quorum.required} trustees needed`;
  return quorum.quorate ? <Badge variant="success">Quorate · {text}</Badge> : <Badge variant="warning">Not quorate · {text}</Badge>;
}

function MeetingView({ d }: { d: MeetingDetail }) {
  const { can } = useAuth();
  const m = d.meeting;
  const editable = can("meetings.manage") && m.status === "draft";
  const userName = useNameLookup();

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/meetings" className="text-muted-foreground underline-offset-4 hover:underline">Trust meetings</Link>
      </p>
      <PageHeader
        title={m.title}
        description={
          <>
            {MEETING_TYPE_LABELS[m.type]} · {formatDateTime(m.startsAt)}
            {m.location && ` · ${m.location}`}
            {m.onlineLink && (
              <>
                {" · "}
                <a href={m.onlineLink} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">Join online</a>
              </>
            )}
          </>
        }
        actions={
          <>
            {editable && <MeetingDialog meeting={m} trigger={<Button variant="outline"><Pencil /> Details</Button>} />}
            <Button variant="outline" asChild>
              <Link to={`/meetings/${m.id}/print`}><Printer /> Print</Link>
            </Button>
            {can("meetings.manage") && (m.status === "draft" ? <ApproveDialog d={d} /> : <ReopenDialog id={m.id} />)}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <MinutesBadge meeting={m} />
        <QuorumBadge quorum={d.quorum} />
      </div>
      {m.status === "approved" && (
        <Alert variant="info" className="mb-4">
          <CheckCircle2 aria-hidden />
          <div>
            Minutes approved {formatDate(m.approvedAt)} by {userName(m.approvedBy)}
            {d.approvedAtMeeting && (
              <>
                {" at "}
                <Link to={`/meetings/${d.approvedAtMeeting.id}`} className="underline underline-offset-4">
                  {d.approvedAtMeeting.title} ({formatDate(d.approvedAtMeeting.startsAt)})
                </Link>
              </>
            )}
            . They're locked; reopen them to make a correction.
          </div>
        </Alert>
      )}

      <Tabs defaultValue="minutes">
        <TabsList>
          <TabsTrigger value="minutes">Agenda and minutes</TabsTrigger>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="actions">Actions ({d.actions.filter((a) => a.status === "open").length + d.carriedForward.length})</TabsTrigger>
          <TabsTrigger value="papers">Papers ({d.papers.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="minutes">
          {/* Remount when the minutes are approved or reopened, so the view matches. */}
          <AgendaEditor key={m.status} d={d} editable={editable} />
        </TabsContent>
        <TabsContent value="register">
          <RegisterEditor key={m.status} d={d} editable={editable} />
        </TabsContent>
        <TabsContent value="actions">
          <ActionsSection d={d} />
        </TabsContent>
        <TabsContent value="papers">
          <PapersSection d={d} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// Agenda and minutes

type ItemDraft = Omit<AgendaItem, "id"> & { id?: string; key: string };

let keySeq = 0;
const nextKey = () => `new-${++keySeq}`;

function AgendaEditor({ d, editable }: { d: MeetingDetail; editable: boolean }) {
  const m = d.meeting;
  const [items, setItems] = useState<ItemDraft[]>(() => m.agenda.map((i) => ({ ...i, key: i.id })));
  const [general, setGeneral] = useState(m.generalMinutes ?? "");
  const [saved, setSaved] = useState(false);
  const save = useOpMutation("meetings.update", MEETING_INVALIDATES);

  if (!editable) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          {m.agenda.length === 0 && !m.generalMinutes && <Empty>No agenda or minutes yet.</Empty>}
          <ol className="flex flex-col gap-4">
            {m.agenda.map((item, n) => (
              <li key={item.id} className="flex flex-col gap-1">
                <h3 className="font-semibold">
                  {n + 1}. {item.title}
                  {item.presenter && <span className="font-normal text-muted-foreground"> · {item.presenter}</span>}
                </h3>
                {item.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p>}
                {item.minutes ? <p className="whitespace-pre-wrap">{item.minutes}</p> : <p className="text-sm italic text-muted-foreground">No minutes recorded.</p>}
              </li>
            ))}
          </ol>
          {m.generalMinutes && (
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold">Other minutes</h3>
              <p className="whitespace-pre-wrap">{m.generalMinutes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const set = (key: string, patch: Partial<ItemDraft>) => {
    setSaved(false);
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  };
  const move = (index: number, by: number) => {
    setSaved(false);
    setItems((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          {
            id: m.id,
            patch: {
              agenda: items.map(({ key: _key, ...i }) => ({
                ...i,
                title: i.title.trim(),
                presenter: i.presenter?.trim() || undefined,
                notes: i.notes?.trim() || undefined,
                minutes: i.minutes?.trim() || undefined,
              })),
              generalMinutes: general.trim(),
            },
          },
          {
            onSuccess: (updated) => {
              // Pick up the ids the server gave new items.
              setItems(updated.agenda.map((i) => ({ ...i, key: i.id })));
              setSaved(true);
            },
          },
        );
      }}
    >
      <ol className="flex flex-col gap-3">
        {items.map((item, n) => (
          <li key={item.key}>
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base">Item {n + 1}</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Move item ${n + 1} up`} disabled={n === 0} onClick={() => move(n, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Move item ${n + 1} down`} disabled={n === items.length - 1} onClick={() => move(n, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove item ${n + 1}`} onClick={() => { setSaved(false); setItems(items.filter((i) => i.key !== item.key)); }}><Trash2 /></Button>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <Field label="Title"><Input required value={item.title} onChange={(e) => set(item.key, { title: e.target.value })} /></Field>
                  <Field label="Presenter"><Input value={item.presenter ?? ""} onChange={(e) => set(item.key, { presenter: e.target.value })} /></Field>
                </div>
                <Field label="Notes for the agenda"><Textarea rows={2} value={item.notes ?? ""} onChange={(e) => set(item.key, { notes: e.target.value })} /></Field>
                <Field label="Minutes" hint="What was discussed and decided.">
                  <Textarea rows={4} value={item.minutes ?? ""} onChange={(e) => set(item.key, { minutes: e.target.value })} />
                </Field>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      <Button variant="outline" className="self-start" onClick={() => { setSaved(false); setItems([...items, { key: nextKey(), title: "" }]); }}>
        <Plus /> Add agenda item
      </Button>
      <Field label="Other minutes" hint="Anything not under one agenda item, such as the opening and close.">
        <Textarea rows={4} value={general} onChange={(e) => { setSaved(false); setGeneral(e.target.value); }} />
      </Field>
      <MutationError error={save.error} />
      {saved && <Alert variant="info">Agenda and minutes saved.</Alert>}
      <Button type="submit" className="self-start" disabled={save.isPending}>Save agenda and minutes</Button>
    </form>
  );
}

// Register

function RegisterEditor({ d, editable }: { d: MeetingDetail; editable: boolean }) {
  const m = d.meeting;
  const directory = useDirectory();
  const userName = useNameLookup();
  const [status, setStatus] = useState<Record<string, AttendanceStatus | "">>(() =>
    Object.fromEntries(m.attendance.map((a) => [a.trusteeId, a.status])),
  );
  const [guests, setGuests] = useState<MeetingGuest[]>(m.guests);
  const [staff, setStaff] = useState<Set<string>>(() => new Set(m.staffUids));
  const [saved, setSaved] = useState(false);
  const save = useOpMutation("meetings.setRegister", MEETING_INVALIDATES);
  const touch = () => setSaved(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          {
            id: m.id,
            attendance: Object.entries(status)
              .filter((entry): entry is [string, AttendanceStatus] => entry[1] !== "")
              .map(([trusteeId, s]) => ({ trusteeId, status: s })),
            guests: guests.filter((g) => g.name.trim()).map((g) => ({ name: g.name.trim(), organisation: g.organisation?.trim() || undefined })),
            staffUids: [...staff],
          },
          { onSuccess: () => setSaved(true) },
        );
      }}
    >
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Trustees</CardTitle>
          <QuorumBadge quorum={d.quorum} />
        </CardHeader>
        <CardContent>
          {d.trustees.length === 0 ? (
            <Empty>No trustees were serving on this date. Add them under Admin, Trustees.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {d.trustees.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t.name} <span className="text-sm text-muted-foreground">· {t.role}</span>
                  </span>
                  {editable ? (
                    <Select
                      aria-label={`Attendance for ${t.name}`}
                      className="sm:max-w-48"
                      value={status[t.id] ?? ""}
                      onChange={(e) => { touch(); setStatus({ ...status, [t.id]: e.target.value as AttendanceStatus | "" }); }}
                    >
                      <option value="">Not recorded</option>
                      {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s === "apologies" ? "Sent apologies" : humanise(s)}</option>)}
                    </Select>
                  ) : (
                    <span className="text-sm">{status[t.id] ? (status[t.id] === "apologies" ? "Sent apologies" : humanise(status[t.id])) : "Not recorded"}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Guests</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {guests.length === 0 && <p className="text-sm text-muted-foreground">No guests.</p>}
            {guests.map((g, n) =>
              editable ? (
                <div key={n} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Field label="Name"><Input value={g.name} onChange={(e) => { touch(); setGuests(guests.map((x, i) => (i === n ? { ...x, name: e.target.value } : x))); }} /></Field>
                  <Field label="Organisation"><Input value={g.organisation ?? ""} onChange={(e) => { touch(); setGuests(guests.map((x, i) => (i === n ? { ...x, organisation: e.target.value } : x))); }} /></Field>
                  <Button variant="ghost" size="icon" aria-label={`Remove guest ${g.name || n + 1}`} onClick={() => { touch(); setGuests(guests.filter((_, i) => i !== n)); }}><Trash2 /></Button>
                </div>
              ) : (
                <p key={n}>{g.name}{g.organisation && <span className="text-muted-foreground"> · {g.organisation}</span>}</p>
              ),
            )}
            {editable && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => { touch(); setGuests([...guests, { name: "" }]); }}>
                <Plus /> Add guest
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Staff in attendance</CardTitle></CardHeader>
          <CardContent className="flex flex-col">
            {editable
              ? directory.data?.map((u) => (
                  <Checkbox
                    key={u.uid}
                    label={u.displayName}
                    checked={staff.has(u.uid)}
                    onChange={(e) => {
                      touch();
                      const next = new Set(staff);
                      if (e.target.checked) next.add(u.uid);
                      else next.delete(u.uid);
                      setStaff(next);
                    }}
                  />
                ))
              : m.staffUids.length
                ? m.staffUids.map((uid) => <p key={uid}>{userName(uid)}</p>)
                : <p className="text-sm text-muted-foreground">No staff recorded.</p>}
          </CardContent>
        </Card>
      </div>

      {editable && (
        <>
          <MutationError error={save.error} />
          {saved && <Alert variant="info">Register saved.</Alert>}
          <Button type="submit" className="self-start" disabled={save.isPending}>Save register</Button>
        </>
      )}
    </form>
  );
}

// Actions

function ActionsSection({ d }: { d: MeetingDetail }) {
  const { can } = useAuth();
  const m = d.meeting;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Raised at this meeting</CardTitle>
          {can("meetings.manage") && m.status === "draft" && (
            <ActionDialog meetingId={m.id} trigger={<Button size="sm"><Plus /> New action</Button>} />
          )}
        </CardHeader>
        <CardContent>
          {d.actions.length ? (
            <ul className="flex flex-col gap-2">{d.actions.map((a) => <ActionItem key={a.id} action={a} />)}</ul>
          ) : (
            <Empty>No actions raised.</Empty>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Open from earlier meetings</CardTitle>
          <p className="text-sm text-muted-foreground">Review these at this meeting. Marking one done records that it was reported done here.</p>
        </CardHeader>
        <CardContent>
          {d.carriedForward.length ? (
            <ul className="flex flex-col gap-2">{d.carriedForward.map((a) => <ActionItem key={a.id} action={a} atMeetingId={m.id} showMeeting />)}</ul>
          ) : (
            <Empty>Nothing carried forward.</Empty>
          )}
        </CardContent>
      </Card>
      {d.completedHere.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Reported done at this meeting</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">{d.completedHere.map((a) => <ActionItem key={a.id} action={a} showMeeting />)}</ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Papers

function PapersSection({ d }: { d: MeetingDetail }) {
  const { can } = useAuth();
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Papers</CardTitle>
        {can("meetings.manage") && <PaperUploadDialog meetingId={d.meeting.id} />}
      </CardHeader>
      <CardContent>
        {d.papers.length ? (
          <ul className="flex flex-col gap-2">{d.papers.map((p) => <PaperItem key={p.id} paper={p} />)}</ul>
        ) : (
          <Empty>No papers yet.</Empty>
        )}
      </CardContent>
    </Card>
  );
}

function PaperItem({ paper }: { paper: MeetingPaper }) {
  const [error, setError] = useState<string | null>(null);
  const size = paper.sizeBytes > 1024 * 1024 ? `${(paper.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(paper.sizeBytes / 1024)} KB`;
  return (
    <li className="flex items-start gap-3 rounded-md border p-2 text-sm">
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{paper.fileName}</span>
        <span className="text-muted-foreground">{paper.description}</span>
        <span className="text-xs text-muted-foreground">{size} · {formatDateTime(paper.createdAt)}</span>
        {error && <span className="text-destructive">{error}</span>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Download ${paper.fileName}`}
        onClick={async () => {
          setError(null);
          try {
            const { url } = await api("meetingPapers.getDownloadUrl", { id: paper.id });
            window.location.assign(url);
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        <Download />
      </Button>
    </li>
  );
}

function PaperUploadDialog({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useOpMutation("meetingPapers.createUpload");
  const complete = useOpMutation("meetingPapers.completeUpload", ["meetings.get"]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { paper, uploadUrl, uploadMethod, uploadHeaders } = await create.mutateAsync({
        meetingId,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        description: description.trim(),
      });
      const res = await fetch(uploadUrl, { method: uploadMethod, headers: uploadHeaders, body: file });
      if (!res.ok) throw new Error(`The upload failed (${res.status}). Please try again.`);
      await complete.mutateAsync({ id: paper.id });
      setOpen(false);
      setFile(null);
      setDescription("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && busy) return; setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild><Button size="sm"><Upload /> Upload paper</Button></DialogTrigger>
      <DialogContent title="Upload a paper" description="PDF, Word, Excel, images or text, up to 25 MB.">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <Field label="File"><Input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Field label="What it is" hint="For example: Treasurer's report, Q2 accounts."><Input required value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" className="self-start" disabled={busy || !file || !description.trim()}>{busy ? "Uploading..." : "Upload"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Approving and reopening minutes

function ApproveDialog({ d }: { d: MeetingDetail }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState("");
  const from = useMemo(() => new Date(new Date(d.meeting.startsAt).getTime() + 60_000).toISOString(), [d.meeting.startsAt]);
  const later = useOp("meetings.list", { from, limit: 20 }, { enabled: open });
  const approve = useOpMutation("meetings.approveMinutes", MEETING_INVALIDATES);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setAt(""); approve.reset(); } }}>
      <DialogTrigger asChild><Button><CheckCircle2 /> Approve minutes</Button></DialogTrigger>
      <DialogContent title="Approve minutes" description="Approved minutes are locked. Minutes are usually approved at the next meeting.">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            approve.mutate({ id: d.meeting.id, atMeetingId: at || undefined }, { onSuccess: () => setOpen(false) });
          }}
        >
          <Field label="Approved at">
            <Select value={at} onChange={(e) => setAt(e.target.value)}>
              <option value="">Not at a meeting</option>
              {later.data?.map((m) => <option key={m.id} value={m.id}>{m.title}, {formatDate(m.startsAt)}</option>)}
            </Select>
          </Field>
          <MutationError error={approve.error} />
          <Button type="submit" className="self-start" disabled={approve.isPending}>Approve</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reopen = useOpMutation("meetings.reopenMinutes", MEETING_INVALIDATES);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setReason(""); reopen.reset(); } }}>
      <DialogTrigger asChild><Button variant="outline"><RotateCcw /> Reopen minutes</Button></DialogTrigger>
      <DialogContent title="Reopen minutes" description="This returns the minutes to draft so they can be corrected. They'll need approving again.">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            reopen.mutate({ id, reason: reason.trim() }, { onSuccess: () => setOpen(false) });
          }}
        >
          <Field label="Why" hint="Kept in the audit log."><Textarea required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <MutationError error={reopen.error} />
          <Button type="submit" className="self-start" disabled={reopen.isPending || !reason.trim()}>Reopen</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
