import { MEETING_TYPE_LABELS, MEETING_TYPES, type Meeting, type MeetingAction, type MeetingType, type OpName } from "@ccm/shared";
import { Check, Pencil, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Field } from "@/components/Field";
import { MutationError } from "@/components/States";
import { UserSelect } from "@/components/UserSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useNameLookup, useOp, useOpMutation } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { formatDate, formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";

export const MEETING_INVALIDATES: OpName[] = ["meetings.list", "meetings.get", "meetingActions.list", "dashboard.get"];

export const useTrustees = () => useOp("trustees.list", { includeInactive: true }, { staleTime: 60_000 });

/** Name for an action's owner: a trustee, a member of staff, or no one yet. */
export function useOwnerName() {
  const trustees = useTrustees();
  const userName = useNameLookup();
  return (a: Pick<MeetingAction, "ownerTrusteeId" | "ownerUid">) => {
    if (a.ownerTrusteeId) return trustees.data?.find((t) => t.id === a.ownerTrusteeId)?.name ?? "Unknown trustee";
    if (a.ownerUid) return userName(a.ownerUid);
    return "No owner";
  };
}

export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function MinutesBadge({ meeting }: { meeting: Pick<Meeting, "status"> }) {
  return meeting.status === "approved" ? <Badge variant="success">Minutes approved</Badge> : <Badge variant="outline">Draft minutes</Badge>;
}

export function MeetingListItem({ meeting }: { meeting: Meeting }) {
  return (
    <li>
      <Link to={`/meetings/${meeting.id}`} className="flex flex-col gap-1 rounded-lg border bg-card p-3 hover:bg-accent sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">{meeting.title}</span>
          <span className="text-sm text-muted-foreground">
            {MEETING_TYPE_LABELS[meeting.type]} · {formatDateTime(meeting.startsAt)}
            {meeting.location && ` · ${meeting.location}`}
          </span>
        </div>
        <MinutesBadge meeting={meeting} />
      </Link>
    </li>
  );
}

interface DetailsDraft {
  title: string;
  type: MeetingType;
  startsAt: string;
  endsAt: string;
  location: string;
  onlineLink: string;
}

/** Create a meeting, or edit the details of one. */
export function MeetingDialog({ meeting, trigger }: { meeting?: Meeting; trigger: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const initial = (): DetailsDraft => ({
    title: meeting?.title ?? "Board meeting",
    type: meeting?.type ?? "board",
    startsAt: meeting ? toLocalInput(meeting.startsAt) : "",
    endsAt: meeting?.endsAt ? toLocalInput(meeting.endsAt) : "",
    location: meeting?.location ?? "",
    onlineLink: meeting?.onlineLink ?? "",
  });
  const [d, setD] = useState<DetailsDraft>(initial);
  const create = useOpMutation("meetings.create", MEETING_INVALIDATES);
  const update = useOpMutation("meetings.update", MEETING_INVALIDATES);
  const mutation = meeting ? update : create;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fields = {
      title: d.title.trim(),
      type: d.type,
      startsAt: fromLocalInput(d.startsAt),
      endsAt: d.endsAt ? fromLocalInput(d.endsAt) : "",
      location: d.location.trim(),
      onlineLink: d.onlineLink.trim(),
    };
    if (meeting) {
      update.mutate({ id: meeting.id, patch: fields }, { onSuccess: () => setOpen(false) });
    } else {
      create.mutate(
        { ...fields, endsAt: fields.endsAt || undefined, onlineLink: fields.onlineLink || undefined, location: fields.location || undefined },
        { onSuccess: (m) => { setOpen(false); navigate(`/meetings/${m.id}`); } },
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setD(initial()); mutation.reset(); }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={meeting ? "Meeting details" : "New meeting"}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Title"><Input required value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as MeetingType })}>
              {MEETING_TYPES.map((t) => <option key={t} value={t}>{MEETING_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts"><Input type="datetime-local" required value={d.startsAt} onChange={(e) => setD({ ...d, startsAt: e.target.value })} /></Field>
            <Field label="Ends" hint="Optional."><Input type="datetime-local" value={d.endsAt} onChange={(e) => setD({ ...d, endsAt: e.target.value })} /></Field>
          </div>
          <Field label="Location" hint="Optional."><Input value={d.location} onChange={(e) => setD({ ...d, location: e.target.value })} /></Field>
          <Field label="Online meeting link" hint="Optional. Must start with https://">
            <Input type="url" value={d.onlineLink} onChange={(e) => setD({ ...d, onlineLink: e.target.value })} />
          </Field>
          <MutationError error={mutation.error} />
          <Button type="submit" className="self-start" disabled={mutation.isPending}>{meeting ? "Save" : "Create meeting"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Owner choice encoded as "trustee:<id>" or "user:<uid>". */
function OwnerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const trustees = useTrustees();
  const serving = trustees.data?.filter((t) => t.active && !t.endDate) ?? [];
  return (
    <Field label="Owner">
      <UserSelect value={value} onChange={(e) => onChange(e.target.value)} emptyLabel="No owner yet">
        {serving.length > 0 && (
          <optgroup label="Trustees">
            {serving.map((t) => <option key={t.id} value={`trustee:${t.id}`}>{t.name} ({t.role})</option>)}
          </optgroup>
        )}
      </UserSelect>
    </Field>
  );
}

function ownerValue(a?: Pick<MeetingAction, "ownerTrusteeId" | "ownerUid">) {
  if (a?.ownerTrusteeId) return `trustee:${a.ownerTrusteeId}`;
  if (a?.ownerUid) return a.ownerUid;
  return "";
}

function ownerFields(v: string) {
  if (v.startsWith("trustee:")) return { ownerTrusteeId: v.slice(8), ownerUid: "" };
  return { ownerTrusteeId: "", ownerUid: v };
}

/** Raise an action at a meeting, or edit one. */
export function ActionDialog({ meetingId, action, trigger }: { meetingId: string; action?: MeetingAction; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [dueDate, setDueDate] = useState("");
  const create = useOpMutation("meetingActions.create", MEETING_INVALIDATES);
  const update = useOpMutation("meetingActions.update", MEETING_INVALIDATES);
  const mutation = action ? update : create;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDescription(action?.description ?? "");
          setOwner(ownerValue(action));
          setDueDate(action?.dueDate ?? "");
          mutation.reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={action ? "Edit action" : "New action"}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fields = { description: description.trim(), ...ownerFields(owner), dueDate };
            if (action) update.mutate({ id: action.id, patch: fields }, { onSuccess: () => setOpen(false) });
            else create.mutate({ meetingId, ...fields }, { onSuccess: () => setOpen(false) });
          }}
        >
          <Field label="What needs doing"><Textarea required rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <OwnerSelect value={owner} onChange={setOwner} />
          <Field label="Due" hint="Optional."><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <MutationError error={mutation.error} />
          <Button type="submit" className="self-start" disabled={mutation.isPending || !description.trim()}>Save</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One action. `atMeetingId` is the meeting being viewed, so marking an
 * earlier action done records that it was reported done there.
 */
export function ActionItem({
  action,
  atMeetingId,
  showMeeting,
  readOnly,
}: {
  action: MeetingAction & { meetingTitle?: string };
  atMeetingId?: string;
  showMeeting?: boolean;
  readOnly?: boolean;
}) {
  const { can } = useAuth();
  const ownerName = useOwnerName();
  const update = useOpMutation("meetingActions.update", MEETING_INVALIDATES);
  const overdue = action.status === "open" && !!action.dueDate && action.dueDate < todayIso();
  const editable = can("meetings.manage") && !readOnly;
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {overdue && <Badge variant="destructive">Overdue</Badge>}
          {action.status === "done" && <Badge variant="success">Done</Badge>}
          {showMeeting && (
            <Link to={`/meetings/${action.meetingId}`} className="text-sm font-semibold underline-offset-4 hover:underline">
              {action.meetingTitle ?? "View meeting"}
            </Link>
          )}
        </div>
        <p className="whitespace-pre-wrap">{action.description}</p>
        <p className="text-xs text-muted-foreground">
          {ownerName(action)}
          {action.dueDate && ` · due ${formatDate(action.dueDate)}`}
          {` · raised ${formatDate(action.raisedAt)}`}
          {action.completedAt && ` · done ${formatDate(action.completedAt)}`}
        </p>
        <MutationError error={update.error} />
      </div>
      {editable && (
        <div className="flex shrink-0 gap-2 print:hidden">
          <ActionDialog meetingId={action.meetingId} action={action} trigger={<Button variant="outline" size="sm"><Pencil /> Edit</Button>} />
          {action.status === "open" ? (
            <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: action.id, patch: { status: "done" }, atMeetingId })}>
              <Check /> Done
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: action.id, patch: { status: "open" } })}>
              <RotateCcw /> Reopen
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
