import type { Client, FileParentKind, FileRecord, LinkedRecordKind, Note } from "@ccm/shared";
import { Download, FileText, Paperclip, Pencil, Upload } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Can } from "@/components/RequirePermission";
import { Empty, MutationError, QueryView } from "@/components/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useNameLookup, useOp, useOpMutation } from "@/hooks/api";
import { useAuth } from "@/hooks/auth";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/format";

const NOTE_INVALIDATES = ["notes.list", "clients.get", "clients.list", "retention.upcoming"] as const;

export function NotesFilesTab({ client }: { client: Client }) {
  const { can } = useAuth();
  const notes = useOp("notes.list", { clientId: client.id, limit: 200 });
  const files = useOp("files.list", { clientId: client.id });
  const editable = client.status === "active" && can("clients.edit");

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Card>
        <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && <NewNote clientId={client.id} />}
          <QueryView query={notes}>
            {(items) =>
              items.length ? (
                <ul className="flex flex-col gap-3">
                  {items.map((n) => (
                    <NoteItem key={n.id} note={n} editable={editable} files={files.data?.filter((f) => f.parent.kind === "note" && f.parent.id === n.id) ?? []} />
                  ))}
                </ul>
              ) : (
                <Empty>No notes yet.</Empty>
              )
            }
          </QueryView>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Files</CardTitle>
          {client.status === "active" && (
            <Can need="files.upload">
              <UploadDialog clientId={client.id} parent={{ kind: "client", id: client.id }} trigger={<Button size="sm"><Upload /> Upload</Button>} />
            </Can>
          )}
        </CardHeader>
        <CardContent>
          <QueryView query={files}>
            {(items) =>
              items.length ? <ul className="flex flex-col gap-2">{items.map((f) => <FileItem key={f.id} file={f} />)}</ul> : <Empty>No files yet.</Empty>
            }
          </QueryView>
        </CardContent>
      </Card>
    </div>
  );
}

function LinkPicker({ clientId, value, onChange }: { clientId: string; value: string; onChange: (v: string) => void }) {
  const sessions = useOp("sessions.list", { clientId, limit: 50 });
  const callbacks = useOp("callbacks.list", { clientId, limit: 50 });
  const outcomes = useOp("outcomes.list", { clientId });
  return (
    <Field label="Linked to" hint="Optional.">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Nothing</option>
        {!!sessions.data?.length && (
          <optgroup label="Sessions">
            {sessions.data.map((s) => <option key={s.id} value={`session:${s.id}`}>Session on {formatDateTime(s.startsAt)}</option>)}
          </optgroup>
        )}
        {!!callbacks.data?.length && (
          <optgroup label="Callbacks">
            {callbacks.data.map((c) => <option key={c.id} value={`callback:${c.id}`}>Callback due {formatDateTime(c.dueAt)}</option>)}
          </optgroup>
        )}
        {!!outcomes.data?.length && (
          <optgroup label="Outcomes">
            {outcomes.data.map((o) => <option key={o.id} value={`outcome:${o.id}`}>Outcome on {formatDateTime(o.recordedAt)}</option>)}
          </optgroup>
        )}
      </Select>
    </Field>
  );
}

function NewNote({ clientId }: { clientId: string }) {
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const create = useOpMutation("notes.create", [...NOTE_INVALIDATES]);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const [kind, id] = link.split(":");
        create.mutate(
          { clientId, body: body.trim(), linkedTo: link ? { kind: kind as LinkedRecordKind, id } : undefined },
          { onSuccess: () => { setBody(""); setLink(""); } },
        );
      }}
    >
      <Field label="New note">
        <Textarea required value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      </Field>
      <LinkPicker clientId={clientId} value={link} onChange={setLink} />
      <MutationError error={create.error} />
      <Button type="submit" className="self-start" disabled={create.isPending || !body.trim()}>Add note</Button>
    </form>
  );
}

function NoteItem({ note, editable, files }: { note: Note; editable: boolean; files: FileRecord[] }) {
  const name = useNameLookup();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const update = useOpMutation("notes.update", [...NOTE_INVALIDATES]);
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{formatDateTime(note.createdAt)} · {name(note.createdBy)}</span>
        {note.updatedAt && <span>(edited)</span>}
        {note.linkedTo && <Badge variant="outline">{humanise(note.linkedTo.kind)}</Badge>}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            update.mutate({ id: note.id, body: body.trim() }, { onSuccess: () => setEditing(false) });
          }}
        >
          <Textarea aria-label="Note" value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          <MutationError error={update.error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={update.isPending || !body.trim()}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => { setBody(note.body); setEditing(false); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap">{note.body}</p>
      )}
      {files.length > 0 && <ul className="flex flex-col gap-1">{files.map((f) => <FileItem key={f.id} file={f} />)}</ul>}
      {editable && !editing && (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
          <Can need="files.upload">
            <UploadDialog clientId={note.clientId} parent={{ kind: "note", id: note.id }} trigger={<Button variant="ghost" size="sm"><Paperclip /> Attach a file</Button>} />
          </Can>
        </div>
      )}
    </li>
  );
}

function FileItem({ file }: { file: FileRecord }) {
  const [error, setError] = useState<string | null>(null);
  const size = file.sizeBytes > 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(file.sizeBytes / 1024)} KB`;
  return (
    <li className="flex items-start gap-3 rounded-md border p-2 text-sm">
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{file.fileName}</span>
        <span className="text-muted-foreground">{file.description}</span>
        <span className="text-xs text-muted-foreground">
          {size} · {formatDateTime(file.createdAt)}
          {file.parent.kind !== "client" && file.parent.kind !== "note" && ` · ${humanise(file.parent.kind)}`}
          {file.status === "pending" && " · upload not finished"}
        </span>
        {error && <span className="text-destructive">{error}</span>}
      </div>
      {file.status === "ready" && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Download ${file.fileName}`}
          onClick={async () => {
            setError(null);
            try {
              const { url } = await api("files.getDownloadUrl", { id: file.id });
              // Signed URLs are served as attachments, so this downloads without leaving the page.
              window.location.assign(url);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          <Download />
        </Button>
      )}
    </li>
  );
}

export function UploadDialog({
  clientId,
  parent,
  trigger,
}: {
  clientId: string;
  parent: { kind: FileParentKind; id: string };
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useOpMutation("files.createUpload");
  const complete = useOpMutation("files.completeUpload", ["files.list"]);

  const resetForm = () => {
    setFile(null);
    setDescription("");
    setError(null);
    create.reset();
    complete.reset();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { file: rec, uploadUrl, uploadMethod, uploadHeaders } = await create.mutateAsync({
        clientId,
        parent,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        description: description.trim(),
      });
      const res = await fetch(uploadUrl, { method: uploadMethod, headers: uploadHeaders, body: file });
      if (!res.ok) throw new Error(`The upload failed (${res.status}). Please try again.`);
      await complete.mutateAsync({ id: rec.id });
      setOpen(false);
      resetForm();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Don't drop the dialog while an upload is running.
        if (!o && busy) return;
        if (!o) resetForm();
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Upload a file" description="Files can be up to 25 MB. They're stored securely and every download is logged.">
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <Field label="File">
            <Input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="What is this?" hint="For example: GP letter about mobility assessment, March 2026.">
            <Textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          {file && file.size > 25 * 1024 * 1024 && <p className="text-sm text-destructive">This file is larger than 25 MB.</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => { resetForm(); setOpen(false); }}>Cancel</Button>
            <Button type="submit" disabled={busy || !file || !description.trim() || file.size > 25 * 1024 * 1024}>{busy ? "Uploading..." : "Upload"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
