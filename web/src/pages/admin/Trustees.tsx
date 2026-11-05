import type { Trustee } from "@ccm/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Empty, MutationError, QueryView } from "@/components/States";
import { UserSelect } from "@/components/UserSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/input";
import { useNameLookup, useOp, useOpMutation } from "@/hooks/api";
import { formatDate } from "@/lib/format";

type Draft = {
  id?: string;
  name: string;
  role: string;
  email: string;
  startDate: string;
  endDate: string;
  active: boolean;
  userUid: string;
};

const BLANK: Draft = { name: "", role: "Trustee", email: "", startDate: "", endDate: "", active: true, userUid: "" };

const toDraft = (t: Trustee): Draft => ({
  id: t.id,
  name: t.name,
  role: t.role,
  email: t.email ?? "",
  startDate: t.startDate ?? "",
  endDate: t.endDate ?? "",
  active: t.active,
  userUid: t.userUid ?? "",
});

export function TrusteesAdmin() {
  const [showFormer, setShowFormer] = useState(false);
  const list = useOp("trustees.list", { includeInactive: showFormer });
  const save = useOpMutation("trustees.upsert", ["trustees.list", "meetings.get"]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const userName = useNameLookup();

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Trustees</CardTitle>
          <p className="text-sm text-muted-foreground">
            The people on the board. They make up meeting registers and the quorum. When someone stands down, set an end date rather than removing
            them, so earlier registers stay complete.
          </p>
        </div>
        {!editing && (
          <Button onClick={() => { save.reset(); setEditing(BLANK); }}>
            <Plus /> Add trustee
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing && (
          <form
            className="flex flex-col gap-3 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing, { onSuccess: () => setEditing(null) });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Role" hint="For example Chair, Treasurer, Secretary or Trustee.">
                <Input required list="trustee-roles" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} />
              </Field>
              <Field label="Email"><Input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
              <Field label="Signs in as" hint="Optional. Links their actions to their account.">
                <UserSelect emptyLabel="Not linked" value={editing.userUid} onChange={(e) => setEditing({ ...editing, userUid: e.target.value })} />
              </Field>
              <Field label="Started"><Input type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></Field>
              <Field label="Stood down" hint="Leave empty while they serve.">
                <Input type="date" value={editing.endDate} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} />
              </Field>
            </div>
            <datalist id="trustee-roles">
              {["Chair", "Vice chair", "Treasurer", "Secretary", "Trustee", "Co-opted member"].map((r) => <option key={r} value={r} />)}
            </datalist>
            <Checkbox label="Currently serving" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
            <MutationError error={save.error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>Save</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        )}
        <Checkbox label="Show former trustees" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} />
        <QueryView query={list}>
          {(items) =>
            items.length ? (
              <ul className="flex flex-col gap-2">
                {items.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">
                        {t.name} <span className="font-normal text-muted-foreground">· {t.role}</span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t.startDate ? `Since ${formatDate(t.startDate)}` : "Start date not recorded"}
                        {t.endDate && ` · stood down ${formatDate(t.endDate)}`}
                        {t.userUid && ` · signs in as ${userName(t.userUid)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {(!t.active || t.endDate) && <Badge variant="outline">Former</Badge>}
                      <Button variant="outline" size="sm" onClick={() => { save.reset(); setEditing(toDraft(t)); }}>Edit</Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No trustees yet.</Empty>
            )
          }
        </QueryView>
      </CardContent>
    </Card>
  );
}
