import type { Callback, Session } from "@ccm/shared";
import { Check, MapPin, Pencil } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/auth";
import { useHelpCategories, useNameLookup, useOpMutation, useSessionLocations, useSessionTypes } from "@/hooks/api";
import { formatDateTime, fromLocalInput, humanise, isOverdue, toLocalInput } from "@/lib/format";
import { ChipPicker } from "./ChipPicker";
import { Field } from "./Field";
import { MutationError } from "./States";
import { UserSelect } from "./UserSelect";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { Input, Select, Textarea } from "./ui/input";

/** List and callback endpoints don't return client names, so pages may pass one in when they have it. */
type WithName<T> = T & { clientName?: string };

// Activity changes a client's last activity date, so client and retention views refresh too.
const CLIENT_ACTIVITY = ["clients.get", "clients.list", "retention.upcoming"] as const;
const CALLBACK_INVALIDATES = ["callbacks.list", "dashboard.get", "reports.activity", ...CLIENT_ACTIVITY] as const;
const SESSION_INVALIDATES = ["sessions.list", "dashboard.get", "reports.activity", "reports.demand", ...CLIENT_ACTIVITY] as const;

/** `readOnly` hides edit actions, for clients that are anonymised or restricted. */
export function CallbackItem({ cb, showClient, readOnly }: { cb: WithName<Callback>; showClient?: boolean; readOnly?: boolean }) {
  const { can } = useAuth();
  const name = useNameLookup();
  const done = useOpMutation("callbacks.update", [...CALLBACK_INVALIDATES]);
  const overdue = cb.status === "open" && isOverdue(cb.dueAt);
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {showClient && (
            <Link to={`/clients/${cb.clientId}/callbacks`} className="font-semibold underline-offset-4 hover:underline">
              {cb.clientName ?? "View client"}
            </Link>
          )}
          {overdue && <Badge variant="destructive">Overdue</Badge>}
          {cb.status !== "open" && <Badge variant="outline">{humanise(cb.status)}</Badge>}
        </div>
        <p className="text-sm">{cb.reason}</p>
        <p className="text-xs text-muted-foreground">
          Due {formatDateTime(cb.dueAt)} · {name(cb.assigneeUid)}
        </p>
        <MutationError error={done.error} />
      </div>
      {can("callbacks.manage") && !readOnly && (
        <div className="flex shrink-0 gap-2">
          <CallbackDialog clientId={cb.clientId} callback={cb} trigger={<Button variant="outline" size="sm"><Pencil /> Edit</Button>} />
          {cb.status === "open" && (
            <Button size="sm" disabled={done.isPending} onClick={() => done.mutate({ id: cb.id, patch: { status: "done" } })}>
              <Check /> Done
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function CallbackDialog({ clientId, callback, trigger }: { clientId: string; callback?: Callback; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { me } = useAuth();
  const create = useOpMutation("callbacks.create", [...CALLBACK_INVALIDATES]);
  const update = useOpMutation("callbacks.update", [...CALLBACK_INVALIDATES]);
  const [form, setForm] = useState({ assigneeUid: "", dueAt: "", reason: "", status: "open" as Callback["status"] });

  useEffect(() => {
    if (!open) return;
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    tomorrow.setHours(10, 0, 0, 0);
    setForm({
      assigneeUid: callback?.assigneeUid ?? me?.user.uid ?? "",
      dueAt: toLocalInput(callback?.dueAt ?? tomorrow.toISOString()),
      reason: callback?.reason ?? "",
      status: callback?.status ?? "open",
    });
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const busy = create.isPending || update.isPending;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dueAt = fromLocalInput(form.dueAt);
    if (callback) {
      await update.mutateAsync({ id: callback.id, patch: { assigneeUid: form.assigneeUid, dueAt, reason: form.reason, status: form.status } });
    } else {
      await create.mutateAsync({ clientId, assigneeUid: form.assigneeUid || undefined, dueAt, reason: form.reason });
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={callback ? "Edit callback" : "New callback"}>
        <form onSubmit={(e) => void submit(e).catch(() => {})} className="flex flex-col gap-4">
          <Field label="Reason">
            <Textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} />
          </Field>
          <Field label="Due">
            <Input type="datetime-local" required value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          </Field>
          <Field label="Assigned to">
            <UserSelect value={form.assigneeUid} onChange={(e) => setForm({ ...form, assigneeUid: e.target.value })} />
          </Field>
          {callback && (
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Callback["status"] })}>
                <option value="open">Open</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </Field>
          )}
          <MutationError error={create.error ?? update.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SESSION_STATUSES: Session["status"][] = ["scheduled", "completed", "cancelled", "did_not_attend"];

export function SessionItem({ s, showClient, readOnly }: { s: WithName<Session>; showClient?: boolean; readOnly?: boolean }) {
  const { can } = useAuth();
  const types = useSessionTypes(true);
  const cats = useHelpCategories(true);
  const locations = useSessionLocations(true);
  const name = useNameLookup();
  const type = types.data?.find((t) => t.id === s.typeId);
  const location = s.locationId ? locations.data?.find((l) => l.id === s.locationId) : undefined;
  const locationText = s.locationId
    ? `${location?.name ?? "Unknown location"}${location?.isOther && s.locationOther ? ` (${s.locationOther})` : ""}`
    : undefined;
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {showClient && (
            <Link to={`/clients/${s.clientId}/sessions`} className="font-semibold underline-offset-4 hover:underline">
              {s.clientName ?? "View client"}
            </Link>
          )}
          <span className="font-medium">{type?.name ?? "Session"}</span>
          <Badge variant={s.status === "completed" ? "success" : s.status === "scheduled" ? "secondary" : "outline"}>{humanise(s.status)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDateTime(s.startsAt)} · {s.durationMinutes} min · {name(s.staffUid)}
        </p>
        {locationText && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-4" aria-hidden /> {locationText}
          </p>
        )}
        {s.helpCategoryIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.helpCategoryIds.map((id) => (
              <Badge key={id} variant="outline">{cats.data?.find((c) => c.id === id)?.name ?? "Category"}</Badge>
            ))}
          </div>
        )}
        {s.notes && <p className="whitespace-pre-wrap text-sm">{s.notes}</p>}
      </div>
      {can("sessions.manage") && !readOnly && (
        <SessionDialog clientId={s.clientId} session={s} trigger={<Button variant="outline" size="sm"><Pencil /> Edit</Button>} />
      )}
    </li>
  );
}

export function SessionDialog({
  clientId,
  session,
  past,
  trigger,
}: {
  clientId: string;
  session?: Session;
  /** Recording a session that already happened. */
  past?: boolean;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { me } = useAuth();
  const types = useSessionTypes();
  const cats = useHelpCategories();
  const locations = useSessionLocations();
  const create = useOpMutation("sessions.create", [...SESSION_INVALIDATES]);
  const update = useOpMutation("sessions.update", [...SESSION_INVALIDATES]);
  const [form, setForm] = useState({
    typeId: "",
    startsAt: "",
    durationMinutes: 60,
    staffUid: "",
    helpCategoryIds: [] as string[],
    notes: "",
    locationId: "",
    locationOther: "",
    status: "scheduled" as Session["status"],
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      typeId: session?.typeId ?? types.data?.[0]?.id ?? "",
      startsAt: toLocalInput(session?.startsAt),
      durationMinutes: session?.durationMinutes ?? 60,
      staffUid: session?.staffUid ?? me?.user.uid ?? "",
      helpCategoryIds: session?.helpCategoryIds ?? [],
      notes: session?.notes ?? "",
      locationId: session?.locationId ?? "",
      locationOther: session?.locationOther ?? "",
      status: session?.status ?? (past ? "completed" : "scheduled"),
    });
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, types.data]);

  const inPerson = types.data?.find((t) => t.id === form.typeId)?.inPerson ?? false;
  // An archived location stays selectable on a session that already uses it.
  const locationOptions = (locations.data ?? []).concat(
    session?.locationId && !locations.data?.some((l) => l.id === session.locationId)
      ? [{ id: session.locationId, name: "Current location (archived)", isOther: false, archived: true }]
      : [],
  );
  const chosen = locationOptions.find((l) => l.id === form.locationId);
  const isOther = !!chosen?.isOther;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      typeId: form.typeId,
      startsAt: fromLocalInput(form.startsAt),
      durationMinutes: Number(form.durationMinutes),
      staffUid: form.staffUid,
      helpCategoryIds: form.helpCategoryIds,
      status: form.status,
    };
    const notes = form.notes.trim();
    const locationId = inPerson ? form.locationId : "";
    const locationOther = inPerson && isOther ? form.locationOther.trim() : "";
    if (session) {
      // "" tells the server to clear the field.
      await update.mutateAsync({ id: session.id, patch: { ...body, notes, locationId, locationOther } });
    } else {
      await create.mutateAsync({
        clientId,
        ...body,
        notes: notes || undefined,
        locationId: locationId || undefined,
        locationOther: locationOther || undefined,
      });
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={session ? "Edit session" : past ? "Record a past session" : "Schedule a session"}>
        <form onSubmit={(e) => void submit(e).catch(() => {})} className="flex flex-col gap-4">
          <Field label="Type">
            <Select required value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })}>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date and time">
              <Input type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </Field>
            <Field label="Duration (minutes)">
              <Input type="number" min={1} max={1440} required value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} />
            </Field>
          </div>
          {inPerson && (
            <>
              <Field label="Location" hint="Where the session takes place. Locations appear in reports.">
                <Select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                  <option value="">Not recorded</option>
                  {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
              {isOther && (
                <Field label="Describe the location" hint="A short description, not an address. Frequent answers can be added to the list.">
                  <Input required maxLength={200} value={form.locationOther} onChange={(e) => setForm({ ...form, locationOther: e.target.value })} />
                </Field>
              )}
            </>
          )}
          <Field label="Staff member">
            <UserSelect value={form.staffUid} onChange={(e) => setForm({ ...form, staffUid: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Session["status"] })}>
              {SESSION_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
            </Select>
          </Field>
          <ChipPicker label="Help given" options={cats.data ?? []} value={form.helpCategoryIds} onChange={(v) => setForm({ ...form, helpCategoryIds: v })} />
          <Field label="Notes">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={4} />
          </Field>
          <MutationError error={create.error ?? update.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || update.isPending || (inPerson && isOther && !form.locationOther.trim())}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
