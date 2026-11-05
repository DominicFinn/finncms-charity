import { useState } from "react";
import { Field } from "@/components/Field";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { useOp, useOpMutation, useSessionLocations } from "@/hooks/api";
import { formatDate } from "@/lib/format";

const NEW = "__new__";

/**
 * Descriptions people typed for the Other location. An admin can move
 * frequent ones onto a proper list entry so reports group them cleanly.
 */
export function OtherLocations() {
  const others = useOp("sessionLocations.otherValues", {});
  const locations = useSessionLocations();
  const upsert = useOpMutation("sessionLocations.upsert", ["sessionLocations.list"]);
  const promote = useOpMutation("sessionLocations.promoteOther", ["sessionLocations.list", "sessionLocations.otherValues", "sessions.list"]);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [moved, setMoved] = useState<number | null>(null);

  const targets = (locations.data ?? []).filter((l) => !l.isOther);
  const toggle = (text: string) => setSelected((s) => (s.includes(text) ? s.filter((t) => t !== text) : [...s, text]));
  const ready = selected.length > 0 && (target === NEW ? !!newName.trim() : !!target);
  const busy = upsert.isPending || promote.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setMoved(null);
    try {
      const locationId = target === NEW ? (await upsert.mutateAsync({ name: newName.trim() })).id : target;
      const res = await promote.mutateAsync({ texts: selected, locationId });
      setMoved(res.moved);
      setSelected([]);
      setTarget("");
      setNewName("");
    } catch {
      // Shown by MutationError below.
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Other descriptions</CardTitle>
        <CardDescription>
          What people typed when they chose Other. Select the ones that belong together and add them to the list. Their sessions move to that
          location.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {moved !== null && <Alert variant="info">Moved {moved} {moved === 1 ? "session" : "sessions"}.</Alert>}
        <QueryView query={others}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty>Nobody has used Other yet.</Empty>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-10"><span className="sr-only">Select</span></Th>
                      <Th>Description</Th>
                      <Th className="text-right">Sessions</Th>
                      <Th>Last used</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {[...rows].sort((a, b) => b.sessions - a.sessions).map((r) => (
                      <Tr key={r.text}>
                        <Td>
                          <input
                            type="checkbox"
                            className="size-5 accent-[var(--primary)]"
                            aria-label={`Select ${r.text}`}
                            checked={selected.includes(r.text)}
                            onChange={() => toggle(r.text)}
                          />
                        </Td>
                        <Td>{r.text}</Td>
                        <Td className="text-right tabular-nums">{r.sessions}</Td>
                        <Td>{formatDate(r.lastUsedAt)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>

                <fieldset className="flex flex-col gap-3 rounded-lg border p-3" disabled={selected.length === 0}>
                  <legend className="px-1 text-sm font-medium">
                    Add {selected.length || "the selected"} {selected.length === 1 ? "description" : "descriptions"} to the list
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Location">
                      <Select
                        value={target}
                        onChange={(e) => {
                          setTarget(e.target.value);
                          if (e.target.value === NEW && !newName) setNewName(selected[0] ?? "");
                        }}
                      >
                        <option value="">Choose one</option>
                        {targets.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        <option value={NEW}>New location...</option>
                      </Select>
                    </Field>
                    {target === NEW && (
                      <Field label="New location name">
                        <Input required value={newName} onChange={(e) => setNewName(e.target.value)} />
                      </Field>
                    )}
                  </div>
                  <MutationError error={upsert.error ?? promote.error} />
                  <Button type="submit" className="self-start" disabled={!ready || busy}>Add to list</Button>
                </fieldset>
              </form>
            )
          }
        </QueryView>
      </CardContent>
    </Card>
  );
}
