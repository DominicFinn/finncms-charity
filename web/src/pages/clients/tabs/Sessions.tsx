import type { Client } from "@ccm/shared";
import { CalendarPlus, History } from "lucide-react";
import { Can } from "@/components/RequirePermission";
import { SessionDialog, SessionItem } from "@/components/records";
import { Empty, QueryView } from "@/components/States";
import { Button } from "@/components/ui/button";
import { useOp } from "@/hooks/api";

export function SessionsTab({ client }: { client: Client }) {
  const list = useOp("sessions.list", { clientId: client.id, limit: 200 });
  const editable = client.status === "active";
  return (
    <div className="flex flex-col gap-4">
      {editable && (
        <Can need="sessions.manage">
          <div className="flex flex-wrap gap-2">
            <SessionDialog clientId={client.id} trigger={<Button><CalendarPlus /> Schedule a session</Button>} />
            <SessionDialog clientId={client.id} past trigger={<Button variant="outline"><History /> Record a past session</Button>} />
          </div>
        </Can>
      )}
      <QueryView query={list}>
        {(items) =>
          items.length ? (
            <ul className="flex flex-col gap-2">
              {[...items].sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map((s) => <SessionItem key={s.id} s={s} readOnly={!editable} />)}
            </ul>
          ) : (
            <Empty>No sessions yet.</Empty>
          )
        }
      </QueryView>
    </div>
  );
}
