import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SessionItem } from "@/components/records";
import { Empty, QueryView } from "@/components/States";
import { Button } from "@/components/ui/button";
import { useOp } from "@/hooks/api";
import { dayKey, formatDay } from "@/lib/format";

export function SessionsPage() {
  const [showPast, setShowPast] = useState(false);
  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (showPast) d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, [showPast]);
  const list = useOp("sessions.list", { staffUid: "me", from, limit: 200 });

  return (
    <>
      <PageHeader
        title="My sessions"
        description={showPast ? "The last 30 days and everything booked." : "Today and everything booked."}
        actions={
          <Button variant="outline" onClick={() => setShowPast(!showPast)}>
            {showPast ? "Hide past sessions" : "Show the last 30 days"}
          </Button>
        }
      />
      <QueryView query={list}>
        {(items) => {
          if (!items.length) return <Empty>No sessions.</Empty>;
          const groups = new Map<string, typeof items>();
          for (const s of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
            const k = dayKey(s.startsAt);
            groups.set(k, [...(groups.get(k) ?? []), s]);
          }
          return (
            <div className="flex flex-col gap-6">
              {[...groups.entries()].map(([k, ss]) => (
                <section key={k} aria-label={formatDay(ss[0].startsAt)}>
                  <h2 className="mb-2 font-semibold">{formatDay(ss[0].startsAt)}</h2>
                  <ul className="flex flex-col gap-2">
                    {ss.map((s) => <SessionItem key={s.id} s={s} showClient />)}
                  </ul>
                </section>
              ))}
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
