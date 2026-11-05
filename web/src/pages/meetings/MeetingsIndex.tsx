import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Can } from "@/components/RequirePermission";
import { Empty, QueryView } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOp } from "@/hooks/api";
import { ActionItem, MeetingDialog, MeetingListItem } from "./parts";

const TABS = ["upcoming", "past", "actions"] as const;
type Tab = (typeof TABS)[number];

export function MeetingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "upcoming";

  return (
    <>
      <PageHeader
        title="Trust meetings"
        description="Board meetings and AGMs: agendas, registers, minutes and the actions that come out of them."
        actions={
          <Can need="meetings.manage">
            <MeetingDialog trigger={<Button><Plus /> New meeting</Button>} />
          </Can>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams(v === "upcoming" ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming"><MeetingList when="upcoming" /></TabsContent>
        <TabsContent value="past"><MeetingList when="past" /></TabsContent>
        <TabsContent value="actions"><ActionsList /></TabsContent>
      </Tabs>
    </>
  );
}

function MeetingList({ when }: { when: "upcoming" | "past" }) {
  // Fixed for the life of the list, so the query key doesn't change on every render.
  const now = useMemo(() => new Date(Date.now() - 6 * 3_600_000).toISOString(), []);
  const list = useOp("meetings.list", when === "upcoming" ? { from: now, limit: 100 } : { to: now, limit: 500 });
  return (
    <QueryView query={list}>
      {(items) => {
        const ordered = when === "past" ? [...items].reverse() : items;
        return ordered.length ? (
          <ul className="flex flex-col gap-2">{ordered.map((m) => <MeetingListItem key={m.id} meeting={m} />)}</ul>
        ) : (
          <Empty>{when === "upcoming" ? "No meetings scheduled." : "No past meetings."}</Empty>
        );
      }}
    </QueryView>
  );
}

type Show = "open" | "mine" | "overdue" | "done";

function ActionsList() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("show");
  const [show, setShow] = useState<Show>(initial === "mine" || initial === "overdue" || initial === "done" ? initial : "open");
  const input =
    show === "done"
      ? { status: "done" as const, limit: 200 }
      : { status: "open" as const, mine: show === "mine", overdue: show === "overdue", limit: 500 };
  const list = useOp("meetingActions.list", input);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Show" className="sm:max-w-xs">
        <Select
          value={show}
          onChange={(e) => {
            const v = e.target.value as Show;
            setShow(v);
            setParams({ tab: "actions", show: v }, { replace: true });
          }}
        >
          <option value="open">All open actions</option>
          <option value="mine">My open actions</option>
          <option value="overdue">Overdue</option>
          <option value="done">Done</option>
        </Select>
      </Field>
      <QueryView query={list}>
        {(items) =>
          items.length ? (
            <ul className="flex flex-col gap-2">{items.map((a) => <ActionItem key={a.id} action={a} showMeeting />)}</ul>
          ) : (
            <Empty>No actions match.</Empty>
          )
        }
      </QueryView>
    </div>
  );
}
