import type { Client, ConsentRestriction } from "@ccm/shared";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHelpCategories } from "@/hooks/api";
import { formatDate, humanise } from "@/lib/format";

const RESTRICTION_TEXT: Record<ConsentRestriction, string> = {
  no_processing: "Consent to process their data has been withdrawn. The record is read only until a manager decides what happens next.",
  no_sensitive_data: "Consent for health and financial information has been withdrawn. Sensitive answers are hidden and can't be added.",
  no_contact: "Consent to contact has been withdrawn. Don't contact this client or book callbacks.",
  no_sharing: "Consent to share with partner organisations has been withdrawn.",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function OverviewTab({ client: c }: { client: Client }) {
  const cats = useHelpCategories(true);
  return (
    <div className="flex flex-col gap-4">
      {c.restrictions.map((r) => (
        <Alert key={r} variant="warning">
          <Lock aria-hidden />
          <div>{RESTRICTION_TEXT[r]}</div>
        </Alert>
      ))}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label="Name">{c.firstName} {c.lastName}</Row>
              <Row label="Preferred name">{c.preferredName}</Row>
              <Row label="Date of birth">{c.dateOfBirth && formatDate(c.dateOfBirth)}</Row>
              <Row label="Address">
                {(c.addressLines.length || c.town || c.postcode) && (
                  <address className="not-italic">
                    {[...c.addressLines, c.town, c.postcode].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                  </address>
                )}
              </Row>
              <Row label="Phone">
                {c.phones.length > 0 &&
                  c.phones.map((p, i) => (
                    <div key={i}>
                      <a href={`tel:${p.number.replace(/\s/g, "")}`} className="underline-offset-4 hover:underline">{p.number}</a>{" "}
                      <span className="text-sm text-muted-foreground">({p.label})</span>
                    </div>
                  ))}
              </Row>
              <Row label="Email">{c.email && <a href={`mailto:${c.email}`} className="underline-offset-4 hover:underline">{c.email}</a>}</Row>
              <Row label="Preferred contact">{c.preferredContactMethod && humanise(c.preferredContactMethod)}</Row>
              <Row label="Help needed">
                {c.helpCategoryIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.helpCategoryIds.map((id) => <Badge key={id} variant="outline" className="whitespace-normal">{cats.data?.find((x) => x.id === id)?.name ?? "Category"}</Badge>)}
                  </div>
                )}
              </Row>
              <Row label="Client since">{formatDate(c.createdAt)}</Row>
              <Row label="Last activity">{c.lastActivityAt && formatDate(c.lastActivityAt)}</Row>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Next of kin and emergency contacts</CardTitle></CardHeader>
          <CardContent>
            {c.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {c.contacts.map((k) => (
                  <li key={k.id} className="flex flex-col gap-0.5 py-2">
                    <span className="flex items-center gap-2 font-medium">
                      {k.name} {k.isNextOfKin && <Badge>Next of kin</Badge>}
                    </span>
                    {k.relationship && <span className="text-sm text-muted-foreground">{k.relationship}</span>}
                    {k.phone && <a href={`tel:${k.phone.replace(/\s/g, "")}`} className="text-sm underline-offset-4 hover:underline">{k.phone}</a>}
                    {k.email && <a href={`mailto:${k.email}`} className="text-sm underline-offset-4 hover:underline">{k.email}</a>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
