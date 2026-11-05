import { CONTACT_METHODS, type Client, type OpInput, type ContactMethod, type EmergencyContact, type PhoneNumber } from "@ccm/shared";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChipPicker } from "@/components/ChipPicker";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { MutationError, QueryView } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { useHelpCategories, useOp, useOpMutation } from "@/hooks/api";
import { humanise } from "@/lib/format";

interface FormState {
  firstName: string;
  lastName: string;
  preferredName: string;
  dateOfBirth: string;
  addressLines: string[];
  town: string;
  postcode: string;
  phones: PhoneNumber[];
  email: string;
  preferredContactMethod: ContactMethod | "";
  contacts: EmergencyContact[];
  helpCategoryIds: string[];
}

const empty: FormState = {
  firstName: "",
  lastName: "",
  preferredName: "",
  dateOfBirth: "",
  addressLines: ["", ""],
  town: "",
  postcode: "",
  phones: [{ label: "Home", number: "" }],
  email: "",
  preferredContactMethod: "",
  contacts: [],
  helpCategoryIds: [],
};

function fromClient(c: Client): FormState {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    preferredName: c.preferredName ?? "",
    dateOfBirth: c.dateOfBirth ?? "",
    addressLines: c.addressLines.length ? c.addressLines : ["", ""],
    town: c.town ?? "",
    postcode: c.postcode ?? "",
    phones: c.phones.length ? c.phones : [{ label: "Home", number: "" }],
    email: c.email ?? "",
    preferredContactMethod: c.preferredContactMethod ?? "",
    contacts: c.contacts,
    helpCategoryIds: c.helpCategoryIds,
  };
}

/**
 * On create, empty optional fields are left out. On edit they're sent as ""
 * so the server clears them.
 */
function toInput(f: FormState, mode: "create" | "edit") {
  const opt = (s: string) => (s.trim() ? s.trim() : mode === "edit" ? "" : undefined);
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    preferredName: opt(f.preferredName),
    dateOfBirth: opt(f.dateOfBirth),
    addressLines: f.addressLines.map((l) => l.trim()).filter(Boolean),
    town: opt(f.town),
    postcode: opt(f.postcode),
    phones: f.phones.filter((p) => p.number.trim()),
    email: opt(f.email),
    preferredContactMethod: f.preferredContactMethod || (mode === "edit" ? "" : undefined),
    contacts: f.contacts.map((c) => ({ ...c, name: c.name.trim(), id: c.id || undefined, email: c.email ?? "", phone: c.phone || undefined })),
    helpCategoryIds: f.helpCategoryIds,
  };
}

export function ClientNewPage() {
  const nav = useNavigate();
  const create = useOpMutation("clients.create", ["clients.list"]);
  return (
    <>
      <PageHeader title="New client" />
      <ClientFormBody
        initial={empty}
        busy={create.isPending}
        error={create.error}
        onCancel={() => nav("/clients")}
        onSubmit={async (f) => {
          const c = await create.mutateAsync(toInput(f, "create") as OpInput<"clients.create">);
          nav(`/clients/${c.id}`);
        }}
      />
    </>
  );
}

export function ClientEditPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const client = useOp("clients.get", { id });
  const update = useOpMutation("clients.update", ["clients.get", "clients.list"]);
  return (
    <>
      <PageHeader title="Edit client" />
      <QueryView query={client}>
        {(c) => (
          <ClientFormBody
            initial={fromClient(c)}
            busy={update.isPending}
            error={update.error}
            onCancel={() => nav(`/clients/${id}`)}
            onSubmit={async (f) => {
              await update.mutateAsync({ id, patch: toInput(f, "edit") as OpInput<"clients.update">["patch"] });
              nav(`/clients/${id}`);
            }}
          />
        )}
      </QueryView>
    </>
  );
}

function ClientFormBody({
  initial,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  initial: FormState;
  onSubmit: (f: FormState) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
}) {
  const [f, setF] = useState(initial);
  const cats = useHelpCategories();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <form
      className="flex max-w-3xl flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(f).catch(() => {});
      }}
    >
      <Card>
        <CardHeader><CardTitle>Personal details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name"><Input required autoComplete="off" value={f.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Last name"><Input required autoComplete="off" value={f.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
          <Field label="Preferred name" hint="What they like to be called."><Input value={f.preferredName} onChange={(e) => set("preferredName", e.target.value)} /></Field>
          <Field label="Date of birth"><Input type="date" value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Address</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {f.addressLines.map((line, i) => (
            <Field key={i} label={`Address line ${i + 1}`} className="sm:col-span-2">
              <Input value={line} onChange={(e) => set("addressLines", f.addressLines.map((l, j) => (j === i ? e.target.value : l)))} />
            </Field>
          ))}
          {f.addressLines.length < 5 && (
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => set("addressLines", [...f.addressLines, ""])}>
              <Plus /> Add a line
            </Button>
          )}
          <Field label="Town" className="sm:col-start-1"><Input value={f.town} onChange={(e) => set("town", e.target.value)} /></Field>
          <Field label="Postcode"><Input value={f.postcode} autoCapitalize="characters" onChange={(e) => set("postcode", e.target.value)} className="uppercase" /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {f.phones.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-end gap-2">
              <Field label="Label"><Input value={p.label} onChange={(e) => set("phones", f.phones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field>
              <Field label="Phone number"><Input type="tel" value={p.number} onChange={(e) => set("phones", f.phones.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} /></Field>
              <Button variant="ghost" size="icon" aria-label={`Remove phone ${i + 1}`} onClick={() => set("phones", f.phones.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {f.phones.length < 5 && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => set("phones", [...f.phones, { label: "Mobile", number: "" }])}>
              <Plus /> Add a phone number
            </Button>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="Preferred contact method">
              <Select value={f.preferredContactMethod} onChange={(e) => set("preferredContactMethod", e.target.value as ContactMethod)}>
                <option value="">Not given</option>
                {CONTACT_METHODS.map((m) => <option key={m} value={m}>{humanise(m)}</option>)}
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Next of kin and emergency contacts</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {f.contacts.map((c, i) => {
            const upd = (patch: Partial<EmergencyContact>) => set("contacts", f.contacts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <fieldset key={c.id || i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">Contact {i + 1}</legend>
                <Field label="Name" error={c.name && !c.name.trim() ? "Enter a name" : undefined}><Input required value={c.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                <Field label="Relationship"><Input value={c.relationship} onChange={(e) => upd({ relationship: e.target.value })} /></Field>
                <Field label="Phone"><Input type="tel" value={c.phone ?? ""} onChange={(e) => upd({ phone: e.target.value })} /></Field>
                <Field label="Email"><Input type="email" value={c.email ?? ""} onChange={(e) => upd({ email: e.target.value })} /></Field>
                <Checkbox label="Next of kin" checked={c.isNextOfKin} onChange={(e) => upd({ isNextOfKin: e.target.checked })} />
                <Button variant="ghost" size="sm" className="justify-self-end" onClick={() => set("contacts", f.contacts.filter((_, j) => j !== i))}>
                  <Trash2 /> Remove
                </Button>
              </fieldset>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => set("contacts", [...f.contacts, { id: "", name: "", relationship: "", isNextOfKin: f.contacts.length === 0 }])}
          >
            <Plus /> Add a contact
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Help needed</CardTitle></CardHeader>
        <CardContent>
          <ChipPicker label="Help categories" options={cats.data ?? []} value={f.helpCategoryIds} onChange={(v) => set("helpCategoryIds", v)} />
        </CardContent>
      </Card>

      <MutationError error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || f.contacts.some((c) => !c.name.trim())}>Save</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
