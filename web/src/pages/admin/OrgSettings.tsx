import type { OrgSettings } from "@ccm/shared";
import { useState } from "react";
import { Field } from "@/components/Field";
import { MutationError } from "@/components/States";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { useOpMutation } from "@/hooks/api";
import { useMe } from "@/hooks/auth";

export function OrgSettingsAdmin() {
  const me = useMe();
  const [s, setS] = useState<OrgSettings>(me.org);
  const [domains, setDomains] = useState(me.org.allowedDomains.join("\n"));
  const [saved, setSaved] = useState(false);
  const save = useOpMutation("org.updateSettings", ["me.get"]);
  const num = (k: keyof OrgSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  return (
    <Card>
      <CardHeader><CardTitle>Organisation settings</CardTitle></CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            save.mutate(
              { ...s, allowedDomains: domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean) },
              { onSuccess: () => setSaved(true) },
            );
          }}
        >
          <Field label="Organisation name"><Input required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
            <legend className="px-1 font-medium">Retention</legend>
            <p className="text-sm text-muted-foreground">
              Clients with no activity for this long are anonymised automatically. Their personal details, notes and files are removed; anonymous
              figures stay for reporting. UK GDPR doesn't set a fixed period, so agree this with your data protection lead. A client with an open
              safeguarding concern is held until it's closed.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Months after last activity" hint={`${(s.retentionMonths / 12).toFixed(1)} years`}>
                <Input type="number" min={1} max={240} required value={s.retentionMonths} onChange={num("retentionMonths")} />
              </Field>
              <Field label="Warn managers this many days before">
                <Input type="number" min={1} max={365} required value={s.retentionWarningDays} onChange={num("retentionWarningDays")} />
              </Field>
              <Field
                label="Days to keep referral details after a decision"
                hint="Once a referral is accepted or declined, its personal details are removed after this many days. Referrals still waiting are kept."
              >
                <Input type="number" min={7} max={3650} required value={s.referralRetentionDays} onChange={num("referralRetentionDays")} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
            <legend className="px-1 font-medium">Sign in</legend>
            <Field label="Google Workspace domains allowed to sign in" hint="One per line. Leave empty so only invited people can sign in. People from these domains start with no roles.">
              <Textarea rows={2} value={domains} onChange={(e) => setDomains(e.target.value)} />
            </Field>
            <Field label="Sign out after this many minutes of no activity" hint="Keep this short on shared or mobile devices.">
              <Input type="number" min={5} max={1440} required value={s.sessionTimeoutMinutes} onChange={num("sessionTimeoutMinutes")} />
            </Field>
          </fieldset>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
            <legend className="px-1 font-medium">Reminders and calendar</legend>
            <Field label="Remind people about callbacks this many hours before">
              <Input type="number" min={1} max={336} required value={s.reminderLeadHours} onChange={num("reminderLeadHours")} />
            </Field>
            <Checkbox
              label="Let staff sync sessions and callbacks to their Google Calendar"
              checked={s.calendarSyncEnabled}
              onChange={(e) => setS({ ...s, calendarSyncEnabled: e.target.checked })}
            />
          </fieldset>

          <MutationError error={save.error} />
          {saved && <Alert variant="info">Settings saved.</Alert>}
          <Button type="submit" className="self-start" disabled={save.isPending}>Save settings</Button>
        </form>
      </CardContent>
    </Card>
  );
}
