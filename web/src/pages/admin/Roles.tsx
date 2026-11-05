import { PERMISSIONS, SUPER_USER_ROLE_ID, type Permission, type Role } from "@ccm/shared";
import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Field } from "@/components/Field";
import { MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/input";
import { useOp, useOpMutation } from "@/hooks/api";

const PERMISSION_LIST = Object.entries(PERMISSIONS) as [Permission, string][];

export function RolesAdmin() {
  const roles = useOp("roles.list", {});
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const del = useOpMutation("roles.delete", ["roles.list"]);
  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        <RoleEditor role={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
      ) : (
        <Button className="self-start" onClick={() => setEditing("new")}><Plus /> New role</Button>
      )}
      <MutationError error={del.error} />
      <QueryView query={roles}>
        {(list) => (
          <div className="flex flex-col gap-3">
            {list.map((r) => {
              const locked = r.id === SUPER_USER_ROLE_ID || r.system;
              return (
                <Card key={r.id}>
                  <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2">{r.name} {locked && <Lock className="size-4" aria-label="Locked" />}</CardTitle>
                      {r.description && <CardDescription>{r.description}</CardDescription>}
                    </div>
                    {!locked && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                        <ConfirmDialog
                          trigger={<Button variant="ghost" size="sm">Delete</Button>}
                          title={`Delete ${r.name}?`}
                          description="You can only delete a role nobody holds."
                          confirmLabel="Delete"
                          destructive
                          onConfirm={() => del.mutateAsync({ id: r.id }).catch(() => {})}
                        />
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-1">
                    {r.permissions.map((p) => <Badge key={p} variant="outline">{PERMISSIONS[p] ?? p}</Badge>)}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </QueryView>
    </div>
  );
}

function RoleEditor({ role, onDone }: { role?: Role; onDone: () => void }) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Permission[]>(role?.permissions ?? []);
  const save = useOpMutation("roles.upsert", ["roles.list", "me.get"]);
  return (
    <Card>
      <CardHeader><CardTitle>{role ? `Edit ${role.name}` : "New role"}</CardTitle></CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ id: role?.id, name, description: description || undefined, permissions: perms }, { onSuccess: onDone });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Permissions</legend>
            <div className="grid sm:grid-cols-2">
              {PERMISSION_LIST.map(([p, label]) => (
                <Checkbox
                  key={p}
                  label={label}
                  checked={perms.includes(p)}
                  onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))}
                />
              ))}
            </div>
          </fieldset>
          <MutationError error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>Save</Button>
            <Button variant="outline" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
