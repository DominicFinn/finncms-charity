import type { Callback } from "@ccm/shared";
import { useState } from "react";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { CallbackItem } from "@/components/records";
import { Empty, QueryView } from "@/components/States";
import { UserSelect } from "@/components/UserSelect";
import { Select } from "@/components/ui/input";
import { useOp } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";

export function CallbacksPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<Callback["status"] | "">("open");
  const [assignee, setAssignee] = useState("me");
  const list = useOp("callbacks.list", { assigneeUid: assignee || undefined, status: status || undefined, limit: 200 });

  return (
    <>
      <PageHeader title="Callbacks" description="Follow ups and reminders." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Callback["status"] | "")}>
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
            <option value="">Any</option>
          </Select>
        </Field>
        {can("callbacks.manage") && (
          <Field label="Assigned to">
            <UserSelect value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="me">Me</option>
            </UserSelect>
          </Field>
        )}
      </div>
      <QueryView query={list}>
        {(items) =>
          items.length ? (
            <ul className="flex flex-col gap-2">
              {[...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map((c) => <CallbackItem key={c.id} cb={c} showClient />)}
            </ul>
          ) : (
            <Empty>No callbacks match.</Empty>
          )
        }
      </QueryView>
    </>
  );
}
