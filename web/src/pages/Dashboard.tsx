import { Bell, ListTodo, ShieldAlert, Timer } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { CallbackItem, SessionItem } from "@/components/records";
import { Empty, QueryView } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOp, useOpMutation } from "@/hooks/api";
import { useMe } from "@/hooks/auth";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DashboardPage() {
  const me = useMe();
  const dash = useOp("dashboard.get", {});
  const markRead = useOpMutation("notifications.markRead", ["dashboard.get"]);
  const first = me.user.displayName.split(" ")[0];

  return (
    <>
      <PageHeader title={`Hello, ${first}`} description="Your callbacks and sessions." />
      <QueryView query={dash}>
        {(d) => (
          <div className="flex flex-col gap-5">
            {(!!d.openSafeguarding || !!d.retentionDue || !!d.overdueMeetingActions) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {!!d.openSafeguarding && (
                  <Link to="/safeguarding" className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                    <ShieldAlert className="size-6 text-destructive" aria-hidden />
                    <span>
                      <strong>{d.openSafeguarding}</strong> open safeguarding {d.openSafeguarding === 1 ? "concern" : "concerns"}
                    </span>
                  </Link>
                )}
                {!!d.retentionDue && (
                  <Link to="/admin/retention" className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
                    <Timer className="size-6 text-warning" aria-hidden />
                    <span>
                      <strong>{d.retentionDue}</strong> {d.retentionDue === 1 ? "client is" : "clients are"} due for anonymisation soon
                    </span>
                  </Link>
                )}
                {!!d.overdueMeetingActions && (
                  <Link to="/meetings?tab=actions&show=overdue" className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
                    <ListTodo className="size-6 text-warning" aria-hidden />
                    <span>
                      <strong>{d.overdueMeetingActions}</strong> overdue trust meeting {d.overdueMeetingActions === 1 ? "action" : "actions"}
                    </span>
                  </Link>
                )}
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Callbacks</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {d.overdueCallbacks.length > 0 && (
                    <section aria-labelledby="overdue">
                      <h3 id="overdue" className="mb-2 text-sm font-semibold text-destructive">Overdue</h3>
                      <ul className="flex flex-col gap-2">
                        {d.overdueCallbacks.map((c) => <CallbackItem key={c.id} cb={c} showClient />)}
                      </ul>
                    </section>
                  )}
                  <section aria-labelledby="upcoming-cb">
                    <h3 id="upcoming-cb" className="mb-2 text-sm font-semibold">Coming up</h3>
                    {d.upcomingCallbacks.length ? (
                      <ul className="flex flex-col gap-2">
                        {d.upcomingCallbacks.map((c) => <CallbackItem key={c.id} cb={c} showClient />)}
                      </ul>
                    ) : (
                      <Empty>No callbacks coming up.</Empty>
                    )}
                  </section>
                  <Button variant="link" asChild className="self-start px-0">
                    <Link to="/callbacks">All my callbacks</Link>
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Upcoming sessions</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {d.upcomingSessions.length ? (
                    <ul className="flex flex-col gap-2">
                      {d.upcomingSessions.map((s) => <SessionItem key={s.id} s={s} showClient />)}
                    </ul>
                  ) : (
                    <Empty>No sessions booked.</Empty>
                  )}
                  <Button variant="link" asChild className="self-start px-0">
                    <Link to="/sessions">All my sessions</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Bell className="size-5" aria-hidden /> Notifications
                </CardTitle>
                {d.notifications.some((n) => !n.readAt) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate({ ids: d.notifications.filter((n) => !n.readAt).map((n) => n.id) })}
                  >
                    Mark all read
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {d.notifications.length ? (
                  <ul className="flex flex-col divide-y">
                    {d.notifications.map((n) => (
                      <li key={n.id} className={cn("flex flex-col gap-0.5 py-2", n.readAt && "opacity-60")}>
                        {n.link ? (
                          <Link to={n.link} className="underline-offset-4 hover:underline" onClick={() => !n.readAt && markRead.mutate({ ids: [n.id] })}>
                            {n.message}
                          </Link>
                        ) : (
                          <span>{n.message}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Nothing new.</Empty>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </QueryView>
    </>
  );
}
