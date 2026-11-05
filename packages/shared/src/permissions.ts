/**
 * Granular permissions. Roles are built from these. The server checks them on
 * every operation; the UI only uses them to hide things the user can't do.
 */
export const PERMISSIONS = {
  "clients.view": "View client records",
  "clients.create": "Create clients",
  "clients.edit": "Edit client details, contacts, notes and questionnaire answers",
  "clients.export": "Export everything held on a client (subject access request)",
  "clients.anonymise": "Anonymise a client (right to erasure)",
  "questionnaires.viewSensitive": "View and answer sensitive question sets (health, finance)",
  "questionnaires.manage": "Manage questions, question sets and outcome measures",
  "sessions.manage": "Create and edit sessions",
  "callbacks.manage": "Create and edit callbacks, including assigning them to others",
  "outcomes.record": "Record outcomes",
  "files.upload": "Upload and attach files",
  "consent.manage": "Record and withdraw consent",
  "reports.view": "View and export reports",
  "users.manage": "Invite, deactivate and assign roles to users; manage roles",
  "config.manage": "Manage help categories, session types and organisation settings",
  "audit.view": "View the audit log",
  "safeguarding.raise": "Raise a safeguarding concern",
  "safeguarding.view": "See safeguarding flags and concerns",
  "safeguarding.manage": "Review, assign, escalate and close safeguarding concerns",
  "retention.manage": "View clients approaching the retention date",
  "mcp.use": "Create personal access tokens and use the MCP server",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SUPER_USER_ROLE_ID = "super-user";

export interface DefaultRole {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  system?: boolean;
}

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    id: SUPER_USER_ROLE_ID,
    name: "Super user",
    description: "Full access. Cannot be deleted, and there must always be at least one.",
    permissions: ALL_PERMISSIONS,
    system: true,
  },
  {
    id: "manager",
    name: "Manager",
    description: "Runs the service day to day, sees reports and the audit log.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "users.manage"),
  },
  {
    id: "caseworker",
    name: "Caseworker",
    description: "Works with clients, including sensitive questionnaires.",
    permissions: [
      "clients.view",
      "clients.create",
      "clients.edit",
      "questionnaires.viewSensitive",
      "sessions.manage",
      "callbacks.manage",
      "outcomes.record",
      "files.upload",
      "consent.manage",
      "safeguarding.raise",
      "safeguarding.view",
      "mcp.use",
    ],
  },
  {
    id: "volunteer",
    name: "Volunteer",
    description: "Sees basic client details, logs sessions and callbacks, can raise concerns.",
    permissions: ["clients.view", "sessions.manage", "callbacks.manage", "safeguarding.raise"],
  },
];
