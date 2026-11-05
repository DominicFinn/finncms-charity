import type { Client } from "@ccm/shared";
import { Empty, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { useOp } from "@/hooks/api";
import { formatDateTime, humanise } from "@/lib/format";

export function AccessLogTab({ client }: { client: Client }) {
  const report = useOp("audit.clientAccess", { clientId: client.id });
  return (
    <QueryView query={report}>
      {(r) => (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Who has accessed this record</CardTitle>
              <CardDescription>Every view and change is logged, through the app or through Claude (MCP).</CardDescription>
            </CardHeader>
            <CardContent>
              {r.byUser.length === 0 ? (
                <Empty>No access recorded.</Empty>
              ) : (
                <Table>
                  <THead><Tr><Th>Person</Th><Th>Times</Th><Th>First</Th><Th>Most recent</Th></Tr></THead>
                  <TBody>
                    {r.byUser.map((u) => (
                      <Tr key={u.actorUid}>
                        <Td className="font-medium">{u.actorName}</Td>
                        <Td className="tabular-nums">{u.count}</Td>
                        <Td>{formatDateTime(u.firstAt)}</Td>
                        <Td>{formatDateTime(u.lastAt)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Detail</CardTitle></CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y text-sm">
                {r.entries.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="text-muted-foreground">{formatDateTime(e.at)}</span>
                    <span className="font-medium">{e.actorName}</span>
                    <span>{humanise(e.action)} {e.entity}</span>
                    <Badge variant="outline">{e.channel.toUpperCase()}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryView>
  );
}
