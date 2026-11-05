import type { UserRecord } from "@ccm/shared";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Input } from "@/components/ui/input";
import { useOp, useOpMutation } from "@/hooks/api";
import { useMe } from "@/hooks/auth";
import { formatDate } from "@/lib/format";

// me.get too, in case someone edits their own roles.
const INVALIDATES = ["users.list", "users.directory", "me.get"] as const;

export function UsersAdmin() {
  const users = useOp("users.list", { includeInactive: true });
  const roles = useOp("roles.list", {});
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? id;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Users</CardTitle>
        <UserDialog trigger={<Button><UserPlus /> Invite someone</Button>} />
      </CardHeader>
      <CardContent>
        <QueryView query={users}>
          {(list) =>
            list.length ? (
              <ul className="flex flex-col divide-y">
                {[...list].sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName)).map((u) => (
                  <li key={u.uid} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {u.displayName || u.email}
                        {!u.active && <Badge variant="outline">Deactivated</Badge>}
                        {u.invited && <Badge variant="secondary">Invited</Badge>}
                      </span>
                      <span className="text-sm text-muted-foreground">{u.email}</span>
                      <span className="flex flex-wrap gap-1">
                        {u.roleIds.map((r) => <Badge key={r} variant="outline">{roleName(r)}</Badge>)}
                        {u.roleIds.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
                      </span>
                      {u.lastSeenAt && <span className="text-xs text-muted-foreground">Last seen {formatDate(u.lastSeenAt)}</span>}
                    </div>
                    <UserDialog user={u} trigger={<Button variant="outline" size="sm">Edit</Button>} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No users.</Empty>
            )
          }
        </QueryView>
      </CardContent>
    </Card>
  );
}

function UserDialog({ user, trigger }: { user?: UserRecord; trigger: React.ReactNode }) {
  const me = useMe();
  const roles = useOp("roles.list", {});
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const invite = useOpMutation("users.invite", [...INVALIDATES]);
  const update = useOpMutation("users.update", [...INVALIDATES]);
  const isSelf = user?.uid === me.user.uid;

  const reset = () => {
    setEmail(user?.email ?? "");
    setDisplayName(user?.displayName ?? "");
    setRoleIds(user?.roleIds ?? []);
    setActive(user?.active ?? true);
    invite.reset();
    update.reset();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title={user ? `Edit ${user.displayName || user.email}` : "Invite someone"}
        description={user ? "Users are never deleted, so the audit history stays complete. Deactivate them instead." : "They sign in with this Google account."}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const done = { onSuccess: () => setOpen(false) };
            if (user) update.mutate({ uid: user.uid, roleIds, active, displayName: displayName || undefined }, done);
            else invite.mutate({ email, displayName: displayName || undefined, roleIds }, done);
          }}
        >
          {!user && (
            <Field label="Google account email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}
          <Field label="Name"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Roles</legend>
            {roles.data?.map((r) => (
              <Checkbox
                key={r.id}
                label={<span>{r.name} <span className="text-muted-foreground">{r.description}</span></span>}
                checked={roleIds.includes(r.id)}
                onChange={(e) => setRoleIds(e.target.checked ? [...roleIds, r.id] : roleIds.filter((x) => x !== r.id))}
              />
            ))}
          </fieldset>
          {user && (
            <Checkbox
              label={isSelf ? "Active (you can't deactivate yourself)" : "Active"}
              checked={active}
              disabled={isSelf}
              onChange={(e) => setActive(e.target.checked)}
            />
          )}
          <MutationError error={invite.error ?? update.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={invite.isPending || update.isPending}>{user ? "Save" : "Send invite"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
