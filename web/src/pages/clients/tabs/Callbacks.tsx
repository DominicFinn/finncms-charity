import type { Client } from "@ccm/shared";
import { Plus } from "lucide-react";
import { Can } from "@/components/RequirePermission";
import { CallbackDialog, CallbackItem } from "@/components/records";
import { Empty, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useOp } from "@/hooks/api";

export function CallbacksTab({ client }: { client: Client }) {
  const list = useOp("callbacks.list", { clientId: client.id, limit: 200 });
  const noContact = client.restrictions.includes("no_contact");
  return (
    <div className="flex flex-col gap-4">
      {noContact && <Alert variant="warning">This client has withdrawn consent to be contacted, so new callbacks can't be booked.</Alert>}
      {client.status === "active" && !noContact && (
        <Can need="callbacks.manage">
          <CallbackDialog clientId={client.id} trigger={<Button className="self-start"><Plus /> New callback</Button>} />
        </Can>
      )}
      <QueryView query={list}>
        {(items) =>
          items.length ? (
            <ul className="flex flex-col gap-2">
              {[...items]
                .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || a.dueAt.localeCompare(b.dueAt))
                .map((c) => <CallbackItem key={c.id} cb={c} readOnly={client.status !== "active"} />)}
            </ul>
          ) : (
            <Empty>No callbacks yet.</Empty>
          )
        }
      </QueryView>
    </div>
  );
}
