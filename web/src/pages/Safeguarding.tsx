import { SAFEGUARDING_STATUSES, type SafeguardingStatus } from "@ccm/shared";
import { useState } from "react";
import { ConcernCard } from "@/components/Concern";
import { PageHeader } from "@/components/PageHeader";
import { Empty, QueryView } from "@/components/States";
import { Button } from "@/components/ui/button";
import { useOp } from "@/hooks/api";
import { humanise } from "@/lib/format";

export function SafeguardingPage() {
  const [status, setStatus] = useState<SafeguardingStatus | "active">("active");
  const list = useOp("safeguarding.list", status === "active" ? { openOnly: true } : { status });
  return (
    <>
      <PageHeader title="Safeguarding" description="Concerns raised about clients. Every view and change is logged." />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {(["active", ...SAFEGUARDING_STATUSES] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === "active" ? "All not closed" : humanise(s)}
          </Button>
        ))}
      </div>
      <QueryView query={list}>
        {(items) =>
          items.length ? (
            <div className="flex flex-col gap-3">{items.map((c) => <ConcernCard key={c.id} concern={c} showClient />)}</div>
          ) : (
            <Empty>No concerns here.</Empty>
          )
        }
      </QueryView>
    </>
  );
}
