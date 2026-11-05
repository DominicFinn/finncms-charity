import { ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Empty, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOp } from "@/hooks/api";
import { useMe } from "@/hooks/auth";
import { formatDate } from "@/lib/format";

export function RetentionAdmin() {
  const me = useMe();
  const list = useOp("retention.upcoming", {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>Due for anonymisation</CardTitle>
        <CardDescription>
          Clients with no activity for {me.org.retentionMonths} months are anonymised automatically. These reach that point in the next{" "}
          {me.org.retentionWarningDays} days. Recording any activity (a session, callback, note or outcome) resets the clock.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryView query={list}>
          {(items) =>
            items.length ? (
              <ul className="flex flex-col divide-y">
                {items.map((c) => (
                  <li key={c.clientId} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <Link to={`/clients/${c.clientId}`} className="font-medium underline-offset-4 hover:underline">{c.displayName}</Link>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      Last activity {formatDate(c.lastActivityAt)} · anonymised after {formatDate(c.anonymiseAfter)}
                      {c.heldBySafeguarding && (
                        <Badge variant="destructive"><ShieldAlert className="size-3" aria-hidden /> Held: open safeguarding concern</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No clients are due soon.</Empty>
            )
          }
        </QueryView>
      </CardContent>
    </Card>
  );
}
