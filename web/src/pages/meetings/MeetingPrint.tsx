import { MEETING_TYPE_LABELS, type AttendanceStatus, type MeetingDetail } from "@ccm/shared";
import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { QueryView } from "@/components/States";
import { Button } from "@/components/ui/button";
import { useNameLookup, useOp } from "@/hooks/api";
import { useMe } from "@/hooks/auth";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { useOwnerName } from "./parts";

/** Minutes and register laid out for printing and signing. */
export function MeetingPrintPage() {
  const { id = "" } = useParams();
  const detail = useOp("meetings.get", { id });
  return <QueryView query={detail}>{(d) => <PrintView d={d} />}</QueryView>;
}

function PrintView({ d }: { d: MeetingDetail }) {
  const me = useMe();
  const userName = useNameLookup();
  const ownerName = useOwnerName();
  const m = d.meeting;
  const byStatus = (s: AttendanceStatus) =>
    d.trustees.filter((t) => m.attendance.some((a) => a.trusteeId === t.id && a.status === s)).map((t) => `${t.name} (${t.role})`);
  const present = byStatus("present");
  const apologies = byStatus("apologies");
  const absent = byStatus("absent");
  const inAttendance = [...m.staffUids.map((uid) => userName(uid)), ...m.guests.map((g) => (g.organisation ? `${g.name}, ${g.organisation}` : g.name))];
  const openActions = [...d.actions, ...d.carriedForward].filter((a) => a.status === "open");

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6 bg-background text-foreground print:max-w-none print:text-[11pt]">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" asChild>
          <Link to={`/meetings/${m.id}`}><ArrowLeft /> Back to meeting</Link>
        </Button>
        <Button onClick={() => window.print()}><Printer /> Print</Button>
      </div>

      <header className="flex flex-col gap-1 border-b pb-4">
        <p className="text-sm text-muted-foreground print:text-black">{me.org.name}</p>
        <h1 className="text-2xl font-bold">Minutes: {m.title}</h1>
        <p>
          {MEETING_TYPE_LABELS[m.type]} held on {formatDateTime(m.startsAt)}
          {m.endsAt && ` to ${formatTime(m.endsAt)}`}
          {m.location && `, ${m.location}`}
          {m.onlineLink && !m.location && ", online"}
        </p>
        {m.status === "draft" && <p className="font-semibold uppercase tracking-wide">Draft: not yet approved</p>}
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Register</h2>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr] print:grid-cols-[10rem_1fr]">
          <dt className="font-medium">Present</dt>
          <dd>{present.join("; ") || "None recorded"}</dd>
          <dt className="font-medium">Apologies</dt>
          <dd>{apologies.join("; ") || "None"}</dd>
          {absent.length > 0 && (
            <>
              <dt className="font-medium">Absent</dt>
              <dd>{absent.join("; ")}</dd>
            </>
          )}
          {inAttendance.length > 0 && (
            <>
              <dt className="font-medium">In attendance</dt>
              <dd>{inAttendance.join("; ")}</dd>
            </>
          )}
          <dt className="font-medium">Quorum</dt>
          <dd>
            {d.quorum.quorate ? "The meeting was quorate" : "The meeting was not quorate"}: {d.quorum.present} trustees present, {d.quorum.required} needed.
          </dd>
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Minutes</h2>
        {m.agenda.map((item, n) => (
          <div key={item.id} className="flex flex-col gap-1 break-inside-avoid">
            <h3 className="font-semibold">
              {n + 1}. {item.title}
              {item.presenter && <span className="font-normal"> ({item.presenter})</span>}
            </h3>
            <p className="whitespace-pre-wrap">{item.minutes || "No minutes recorded."}</p>
          </div>
        ))}
        {m.generalMinutes && (
          <div className="flex flex-col gap-1 break-inside-avoid">
            <h3 className="font-semibold">Other business</h3>
            <p className="whitespace-pre-wrap">{m.generalMinutes}</p>
          </div>
        )}
        {m.agenda.length === 0 && !m.generalMinutes && <p>No minutes recorded.</p>}
      </section>

      {(openActions.length > 0 || d.completedHere.length > 0) && (
        <section className="flex flex-col gap-2 break-inside-avoid">
          <h2 className="text-lg font-semibold">Actions</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-2">Action</th>
                <th className="py-1 pr-2">Owner</th>
                <th className="py-1 pr-2">Due</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...openActions, ...d.completedHere].map((a) => (
                <tr key={a.id} className="border-b align-top">
                  <td className="py-1 pr-2 whitespace-pre-wrap">{a.description}</td>
                  <td className="py-1 pr-2">{ownerName(a)}</td>
                  <td className="py-1 pr-2">{a.dueDate ? formatDate(a.dueDate) : ""}</td>
                  <td className="py-1">{a.status === "done" ? "Done" : a.meetingId === m.id ? "New" : "Carried forward"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d.papers.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Papers</h2>
          <ul className="list-disc pl-5">
            {d.papers.map((p) => <li key={p.id}>{p.description} ({p.fileName})</li>)}
          </ul>
        </section>
      )}

      <section className="mt-6 flex flex-col gap-6 break-inside-avoid">
        {m.status === "approved" && (
          <p>
            Approved as a true record on {formatDate(m.approvedAt)}
            {d.approvedAtMeeting && ` at ${d.approvedAtMeeting.title} (${formatDate(d.approvedAtMeeting.startsAt)})`}.
          </p>
        )}
        <div className="grid gap-8 sm:grid-cols-2 print:grid-cols-2">
          <div className="flex flex-col gap-1">
            <div className="h-10 border-b border-foreground" />
            <span className="text-sm">Signed (Chair)</span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="h-10 border-b border-foreground" />
            <span className="text-sm">Date</span>
          </div>
        </div>
      </section>
    </article>
  );
}
