import { NavLink, Navigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/alert";
import { useAuth } from "@/hooks/auth";
import type { PermissionRequirement } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { IntegrationKeysAdmin } from "./IntegrationKeys";
import { HelpCategoriesAdmin, SessionLocationsAdmin, SessionTypesAdmin } from "./ManagedLists";
import { OrgSettingsAdmin } from "./OrgSettings";
import { QuestionsAdmin } from "./Questions";
import { QuestionSetsAdmin } from "./QuestionSets";
import { RetentionAdmin } from "./Retention";
import { RolesAdmin } from "./Roles";
import { TrusteesAdmin } from "./Trustees";
import { UsersAdmin } from "./Users";

const SECTIONS: { id: string; label: string; need: PermissionRequirement; render: () => React.ReactNode }[] = [
  { id: "users", label: "Users", need: "users.manage", render: () => <UsersAdmin /> },
  { id: "roles", label: "Roles", need: "users.manage", render: () => <RolesAdmin /> },
  { id: "questions", label: "Questions", need: "questionnaires.manage", render: () => <QuestionsAdmin /> },
  { id: "question-sets", label: "Questionnaires and outcome measures", need: "questionnaires.manage", render: () => <QuestionSetsAdmin /> },
  { id: "help-categories", label: "Help categories", need: "config.manage", render: () => <HelpCategoriesAdmin /> },
  { id: "session-types", label: "Session types", need: "config.manage", render: () => <SessionTypesAdmin /> },
  { id: "session-locations", label: "Session locations", need: "config.manage", render: () => <SessionLocationsAdmin /> },
  { id: "trustees", label: "Trustees", need: "meetings.manage", render: () => <TrusteesAdmin /> },
  { id: "settings", label: "Organisation settings", need: "config.manage", render: () => <OrgSettingsAdmin /> },
  { id: "retention", label: "Retention", need: "retention.manage", render: () => <RetentionAdmin /> },
  { id: "integrations", label: "Integration keys", need: "integrations.manage", render: () => <IntegrationKeysAdmin /> },
];

export function AdminPage() {
  const { section } = useParams();
  const { can } = useAuth();
  const allowed = SECTIONS.filter((s) => can(s.need));
  if (allowed.length === 0) return <Alert variant="warning">You don't have access to any admin settings.</Alert>;
  const current = allowed.find((s) => s.id === section);
  if (!current) return <Navigate to={`/admin/${allowed[0].id}`} replace />;

  return (
    <>
      <PageHeader title="Admin" />
      <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
        <nav aria-label="Admin sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:px-0">
          {allowed.map((s) => (
            <NavLink
              key={s.id}
              to={`/admin/${s.id}`}
              className={({ isActive }) =>
                cn("flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm", isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent")
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <section aria-label={current.label} className="min-w-0">{current.render()}</section>
      </div>
    </>
  );
}
