import { Plus } from "lucide-react";
import { OtherLocations } from "./OtherLocations";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/input";
import { useHelpCategories, useOpMutation, useSessionLocations, useSessionTypes } from "@/hooks/api";

interface Item {
  id: string;
  name: string;
  archived: boolean;
  description?: string;
  inPerson?: boolean;
  isOther?: boolean;
}

function ListEditor({
  title,
  intro,
  query,
  save,
  withDescription,
  withInPerson,
  withIsOther,
}: {
  title: string;
  intro: string;
  query: { data: Item[] | undefined; isLoading: boolean; error: unknown };
  save: (item: Omit<Item, "id"> & { id?: string }) => Promise<unknown>;
  withDescription?: boolean;
  withInPerson?: boolean;
  withIsOther?: boolean;
}) {
  const [editing, setEditing] = useState<Item | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const blank: Item = { id: "", name: "", archived: false, description: "", inPerson: false, isOther: false };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await save({ ...editing, id: editing.id || undefined, description: editing.description || undefined });
      setEditing(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{intro}</p>
        </div>
        {!editing && <Button onClick={() => setEditing(blank)}><Plus /> Add</Button>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing && (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-lg border p-3">
            <Field label="Name"><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            {withDescription && (
              <Field label="Description"><Input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            )}
            {withInPerson && (
              <Checkbox label="In person (asks for a location)" checked={!!editing.inPerson} onChange={(e) => setEditing({ ...editing, inPerson: e.target.checked })} />
            )}
            {withIsOther && (
              <Checkbox
                label="This is the Other option (asks for a short description)"
                checked={!!editing.isOther}
                onChange={(e) => setEditing({ ...editing, isOther: e.target.checked })}
              />
            )}
            {editing.id && <Checkbox label="Archived (kept for reports, hidden from new records)" checked={editing.archived} onChange={(e) => setEditing({ ...editing, archived: e.target.checked })} />}
            <MutationError error={error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Save</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        )}
        <QueryView query={query}>
          {(items) =>
            items.length ? (
              <ul className="flex flex-col divide-y">
                {items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        {i.name}
                        {i.inPerson && <Badge variant="outline">In person</Badge>}
                        {i.isOther && <Badge variant="outline">Other</Badge>}
                        {i.archived && <Badge variant="secondary">Archived</Badge>}
                      </span>
                      {i.description && <span className="text-sm text-muted-foreground">{i.description}</span>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEditing(i)}>Edit</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>None yet.</Empty>
            )
          }
        </QueryView>
      </CardContent>
    </Card>
  );
}

export function HelpCategoriesAdmin() {
  const query = useHelpCategories(true);
  const save = useOpMutation("helpCategories.upsert", ["helpCategories.list"]);
  return (
    <ListEditor
      title="Help categories"
      intro="The types of help the charity gives. Clients, sessions and outcomes are tagged with these for reporting."
      query={query}
      withDescription
      save={(i) => save.mutateAsync({ id: i.id, name: i.name, description: i.description, archived: i.archived })}
    />
  );
}

export function SessionTypesAdmin() {
  const query = useSessionTypes(true);
  const save = useOpMutation("sessionTypes.upsert", ["sessionTypes.list"]);
  return (
    <ListEditor
      title="Session types"
      intro="How sessions take place, for example in person, video call or phone call."
      query={query}
      withInPerson
      save={(i) => save.mutateAsync({ id: i.id, name: i.name, inPerson: !!i.inPerson, archived: i.archived })}
    />
  );
}

export function SessionLocationsAdmin() {
  const query = useSessionLocations(true);
  const save = useOpMutation("sessionLocations.upsert", ["sessionLocations.list"]);
  return (
    <div className="flex flex-col gap-4">
      <ListEditor
        title="Session locations"
        intro="Where in-person sessions take place. Reports group sessions by these. Keep one Other option for anything not on the list."
        query={query}
        withIsOther
        save={(i) => save.mutateAsync({ id: i.id, name: i.name, isOther: !!i.isOther, archived: i.archived })}
      />
      <OtherLocations />
    </div>
  );
}
