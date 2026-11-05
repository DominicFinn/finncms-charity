import type { ReferralStatus, ReferralSummary } from "@ccm/shared";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Empty, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { useNameLookup, useOp } from "@/hooks/api";
import { useMe } from "@/hooks/auth";
import { formatDateTime, humanise } from "@/lib/format";

type Filter = ReferralStatus | "open" | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Waiting" },
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "accepted", label: "Accepted" },
  { id: "declined", label: "Declined" },
  { id: "all", label: "All" },
];

const statusVariant: Record<ReferralStatus, "default" | "secondary" | "success" | "outline"> = {
  new: "default",
  contacted: "secondary",
  accepted: "success",
  declined: "outline",
};

export function ReferralStatusBadge({ status }: { status: ReferralStatus }) {
  return <Badge variant={statusVariant[status]}>{humanise(status)}</Badge>;
}

export const REFERRER_LABEL = { self: "Self referral", family_or_friend: "Family or friend", professional: "Professional" } as const;

function ReferralCard({ r }: { r: ReferralSummary }) {
  const name = useNameLookup();
  return (
    <li>
      <Link to={`/referrals/${r.id}`} className="flex flex-col gap-1 rounded-lg border bg-card p-3 hover:bg-accent/40">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.displayName}</span>
          <ReferralStatusBadge status={r.status} />
          <span className="text-xs text-muted-foreground">{r.reference}</span>
        </span>
        <span className="text-sm text-muted-foreground">
          {REFERRER_LABEL[r.referrerType]} via {r.source} · {formatDateTime(r.createdAt)}
          {(r.town || r.postcodeDistrict) && ` · ${[r.town, r.postcodeDistrict].filter(Boolean).join(", ")}`}
        </span>
        {(r.assigneeUid || r.helpCategoryHints.length > 0) && (
          <span className="text-sm">
            {r.assigneeUid && `With ${name(r.assigneeUid)}`}
            {r.assigneeUid && r.helpCategoryHints.length > 0 && " · "}
            {r.helpCategoryHints.join(", ")}
          </span>
        )}
      </Link>
    </li>
  );
}

export function ReferralsPage() {
  const me = useMe();
  const [status, setStatus] = useState<Filter>("open");
  const [mine, setMine] = useState(false);
  const list = useOp("referrals.list", { status, assigneeUid: mine ? me.user.uid : undefined });
  return (
    <>
      <PageHeader title="Referrals" description="People referred to us through the website and other routes. Accept to create a client, or decline with a reason." />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Button key={f.id} size="sm" variant={status === f.id ? "default" : "outline"} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
              {f.label}
            </Button>
          ))}
        </div>
        <Checkbox label="Only referrals assigned to me" checked={mine} onChange={(e) => setMine(e.target.checked)} />
      </div>
      <QueryView query={list}>
        {(page) =>
          page.items.length ? (
            <ul className="flex flex-col gap-2">
              {page.items.map((r) => <ReferralCard key={r.id} r={r} />)}
            </ul>
          ) : (
            <Empty>
              <Inbox className="mx-auto mb-2 size-6" aria-hidden />
              No referrals here.
            </Empty>
          )
        }
      </QueryView>
    </>
  );
}
