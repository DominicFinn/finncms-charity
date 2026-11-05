/**
 * The operation registry. Every read and write in the system is one of these
 * operations. The web app calls them through the `api` callable function and
 * the MCP server exposes a subset of them as tools. Both paths run the same
 * server code, so permissions and auditing are identical.
 */
import { z } from "zod";
import type * as D from "./domain.js";
import {
  ATTENDANCE_STATUSES,
  CONSENT_PURPOSES,
  MEETING_TYPES,
  CONTACT_METHODS,
  QUESTION_TYPES,
  REPORT_DIMENSIONS,
  SAFEGUARDING_SEVERITIES,
  SAFEGUARDING_STATUSES,
} from "./domain.js";
import { ALL_PERMISSIONS, type Permission } from "./permissions.js";

const id = z.string().min(1).max(128);
const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const shortText = z.string().trim().max(200);
const longText = z.string().max(20_000);
const limit = z.number().int().min(1).max(500).default(50);

const answerValue = z.union([z.string().max(5000), z.number(), z.boolean(), z.array(z.string().max(500)), z.null()]);
const answers = z.record(z.string(), answerValue);

export const phoneSchema = z.object({ label: shortText, number: z.string().trim().min(3).max(40) });

export const contactSchema = z.object({
  id: id.optional(),
  name: shortText.min(1),
  relationship: shortText,
  phone: z.string().trim().max(40).optional(),
  email: z.email().optional().or(z.literal("")),
  isNextOfKin: z.boolean().default(false),
});

/**
 * Client fields without defaults. Updates use this partial, because zod
 * applies defaults inside `.partial()` and a patch would otherwise blank
 * every list field it didn't mention.
 */
const clientFields = z.object({
  firstName: shortText.min(1),
  lastName: shortText.min(1),
  preferredName: shortText.optional(),
  // "" clears the field on update.
  dateOfBirth: isoDate.optional().or(z.literal("")),
  addressLines: z.array(shortText).max(5),
  town: shortText.optional(),
  postcode: z.string().trim().max(10).optional(),
  phones: z.array(phoneSchema).max(5),
  email: z.email().optional().or(z.literal("")),
  preferredContactMethod: z.enum(CONTACT_METHODS).optional().or(z.literal("")),
  contacts: z.array(contactSchema).max(10),
  helpCategoryIds: z.array(id).max(50),
});

export const clientInputSchema = clientFields.extend({
  addressLines: clientFields.shape.addressLines.default([]),
  phones: clientFields.shape.phones.default([]),
  contacts: clientFields.shape.contacts.default([]),
  helpCategoryIds: clientFields.shape.helpCategoryIds.default([]),
});

export const clientPatchSchema = clientFields.partial();

export const reportFiltersSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  town: shortText.optional(),
  postcodeDistrict: shortText.optional(),
  locationId: id.optional(),
  helpCategoryId: id.optional(),
  sessionTypeId: id.optional(),
  staffUid: id.optional(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const trusteeSchema = z.object({
  id: id.optional(),
  name: shortText.min(1),
  role: shortText.min(1),
  // "" clears the field on update.
  email: z.email().optional().or(z.literal("")),
  startDate: isoDate.optional().or(z.literal("")),
  endDate: isoDate.optional().or(z.literal("")),
  active: z.boolean().default(true),
  userUid: id.optional().or(z.literal("")),
});

export const agendaItemSchema = z.object({
  id: id.optional(),
  title: shortText.min(1),
  presenter: shortText.optional(),
  notes: longText.optional(),
  minutes: longText.optional(),
});

/** Meeting fields without defaults, so a patch only changes what it names. */
const meetingFields = z.object({
  title: shortText.min(1),
  type: z.enum(MEETING_TYPES),
  startsAt: isoDateTime,
  endsAt: isoDateTime.optional().or(z.literal("")),
  location: shortText.optional(),
  onlineLink: z.url({ protocol: /^https$/ }).max(500).optional().or(z.literal("")),
  agenda: z.array(agendaItemSchema).max(60),
  generalMinutes: longText.optional(),
});

const actionFields = z.object({
  description: z.string().trim().min(1).max(2000),
  ownerTrusteeId: id.optional().or(z.literal("")),
  ownerUid: id.optional().or(z.literal("")),
  dueDate: isoDate.optional().or(z.literal("")),
});

const dimension = z.enum(REPORT_DIMENSIONS).nullable().default(null);

/**
 * `permission` is what the caller needs. "authenticated" means any active
 * user. Finer rules (sensitive sets, safeguarding visibility, restrictions)
 * are enforced inside the handler.
 */
interface OpDef<I extends z.ZodType> {
  input: I;
  permission: Permission | Permission[] | "authenticated";
  description: string;
  /** Exposed as an MCP tool. */
  mcp: boolean;
  /** Changes data. Used to label MCP tools and to skip read audits. */
  write: boolean;
}

function op<I extends z.ZodType>(def: OpDef<I>): OpDef<I> {
  return def;
}

export const ops = {
  // Session and dashboard
  "me.get": op({
    input: z.object({}),
    permission: "authenticated",
    description: "Get the signed in user, their permissions and organisation settings.",
    mcp: true,
    write: false,
  }),
  "dashboard.get": op({
    input: z.object({}),
    permission: "authenticated",
    description: "Get the current user's overdue and upcoming callbacks, upcoming sessions and notifications.",
    mcp: true,
    write: false,
  }),
  "notifications.markRead": op({
    input: z.object({ ids: z.array(id).max(100) }),
    permission: "authenticated",
    description: "Mark notifications as read.",
    mcp: false,
    write: true,
  }),
  "users.directory": op({
    input: z.object({}),
    permission: "authenticated",
    description: "List active staff (id and name only) for assigning sessions and callbacks.",
    mcp: true,
    write: false,
  }),

  // Clients
  "clients.list": op({
    input: z.object({
      search: z.string().trim().max(100).optional(),
      status: z.enum(["active", "restricted", "anonymised", "all"]).default("active"),
      helpCategoryId: id.optional(),
      town: shortText.optional(),
      flaggedOnly: z.boolean().default(false),
      limit,
      cursor: z.string().max(200).optional(),
    }),
    permission: "clients.view",
    description: "Search and list clients. Search matches first name, last name, preferred name or postcode.",
    mcp: true,
    write: false,
  }),
  "clients.get": op({
    input: z.object({ id }),
    permission: "clients.view",
    description: "Get a client's full record, including contacts and attached question sets.",
    mcp: true,
    write: false,
  }),
  "clients.create": op({
    input: clientInputSchema,
    permission: "clients.create",
    description: "Create a new client.",
    mcp: true,
    write: true,
  }),
  "clients.update": op({
    input: z.object({ id, patch: clientPatchSchema }),
    permission: "clients.edit",
    description: "Update a client's details. Only the fields given are changed. Contacts are replaced as a whole list.",
    mcp: true,
    write: true,
  }),
  "clients.setQuestionSet": op({
    input: z.object({ clientId: id, setId: id, attached: z.boolean() }),
    permission: "clients.edit",
    description: "Attach or detach a questionnaire set for a client.",
    mcp: true,
    write: true,
  }),
  "clients.export": op({
    input: z.object({ id }),
    permission: "clients.export",
    description: "Export everything held on a client for a subject access request.",
    mcp: false,
    write: false,
  }),
  "clients.anonymise": op({
    // A fixed basis rather than free text, because the audit entry for an
    // anonymisation must not hold personal data.
    input: z.object({ id, basis: z.enum(["erasure_request", "no_longer_needed"]) }),
    permission: "clients.anonymise",
    description: "Irreversibly anonymise a client (right to erasure).",
    mcp: false,
    write: true,
  }),

  // Questionnaires
  "questions.list": op({
    input: z.object({ includeArchived: z.boolean().default(false) }),
    permission: "authenticated",
    description: "List reusable questions.",
    mcp: true,
    write: false,
  }),
  "questions.upsert": op({
    input: z.object({
      id: id.optional(),
      text: z.string().trim().min(1).max(500),
      helpText: z.string().trim().max(1000).optional(),
      type: z.enum(QUESTION_TYPES),
      options: z.array(shortText.min(1)).max(50).optional(),
      scale: z
        .object({
          min: z.number().int(),
          max: z.number().int(),
          minLabel: shortText.optional(),
          maxLabel: shortText.optional(),
        })
        .optional(),
      archived: z.boolean().default(false),
    }),
    permission: "questionnaires.manage",
    description: "Create or update a question.",
    mcp: false,
    write: true,
  }),
  "questionSets.list": op({
    input: z.object({ kind: z.enum(["questionnaire", "outcome"]).optional(), includeArchived: z.boolean().default(false) }),
    permission: "authenticated",
    description: "List question sets (questionnaires and outcome measures).",
    mcp: true,
    write: false,
  }),
  "questionSets.upsert": op({
    input: z.object({
      id: id.optional(),
      name: shortText.min(1),
      description: z.string().trim().max(1000).optional(),
      kind: z.enum(["questionnaire", "outcome"]),
      sensitive: z.boolean().default(false),
      questionIds: z.array(id).max(100),
      attachByDefault: z.boolean().default(false),
      archived: z.boolean().default(false),
    }),
    permission: "questionnaires.manage",
    description: "Create or update a question set.",
    mcp: false,
    write: true,
  }),
  "answers.get": op({
    input: z.object({ clientId: id, setId: id, includeHistory: z.boolean().default(false) }),
    permission: "clients.view",
    description: "Get a client's current answers to a question set, optionally with earlier versions.",
    mcp: true,
    write: false,
  }),
  "answers.save": op({
    input: z.object({ clientId: id, setId: id, answers }),
    permission: "clients.edit",
    description: "Save a new version of a client's answers to a question set.",
    mcp: true,
    write: true,
  }),

  // Managed lists
  "helpCategories.list": op({
    input: z.object({ includeArchived: z.boolean().default(false) }),
    permission: "authenticated",
    description: "List help categories.",
    mcp: true,
    write: false,
  }),
  "helpCategories.upsert": op({
    input: z.object({
      id: id.optional(),
      name: shortText.min(1),
      description: z.string().trim().max(500).optional(),
      archived: z.boolean().default(false),
    }),
    permission: "config.manage",
    description: "Create or update a help category.",
    mcp: false,
    write: true,
  }),
  "sessionTypes.list": op({
    input: z.object({ includeArchived: z.boolean().default(false) }),
    permission: "authenticated",
    description: "List session types.",
    mcp: true,
    write: false,
  }),
  "sessionTypes.upsert": op({
    input: z.object({ id: id.optional(), name: shortText.min(1), inPerson: z.boolean(), archived: z.boolean().default(false) }),
    permission: "config.manage",
    description: "Create or update a session type.",
    mcp: false,
    write: true,
  }),

  "sessionLocations.list": op({
    input: z.object({ includeArchived: z.boolean().default(false) }),
    permission: "authenticated",
    description: "List session locations (where in-person sessions take place).",
    mcp: true,
    write: false,
  }),
  "sessionLocations.upsert": op({
    input: z.object({ id: id.optional(), name: shortText.min(1), isOther: z.boolean().default(false), archived: z.boolean().default(false) }),
    permission: "config.manage",
    description: "Create or update a session location.",
    mcp: false,
    write: true,
  }),
  "sessionLocations.otherValues": op({
    input: z.object({}),
    permission: "config.manage",
    description: "Descriptions typed for the Other location, with how often each is used.",
    mcp: false,
    write: false,
  }),
  "sessionLocations.promoteOther": op({
    input: z.object({ texts: z.array(shortText.min(1)).min(1).max(50), locationId: id }),
    permission: "config.manage",
    description: "Move sessions whose Other description matches one of these texts to a managed location.",
    mcp: false,
    write: true,
  }),

  // Sessions
  "sessions.list": op({
    input: z.object({
      clientId: id.optional(),
      staffUid: z.union([id, z.literal("me")]).optional(),
      from: isoDateTime.optional(),
      to: isoDateTime.optional(),
      status: z.enum(["scheduled", "completed", "cancelled", "did_not_attend"]).optional(),
      limit,
    }),
    permission: "clients.view",
    description: "List sessions for a client or a staff member, optionally within a date range.",
    mcp: true,
    write: false,
  }),
  "sessions.create": op({
    input: z.object({
      clientId: id,
      typeId: id,
      startsAt: isoDateTime,
      durationMinutes: z.number().int().min(1).max(24 * 60),
      staffUid: id.optional(),
      helpCategoryIds: z.array(id).max(20).default([]),
      notes: longText.optional(),
      locationId: id.optional(),
      locationOther: shortText.optional(),
      status: z.enum(["scheduled", "completed", "cancelled", "did_not_attend"]).default("scheduled"),
    }),
    permission: "sessions.manage",
    description: "Schedule a session or record one after the fact (set status to completed). Staff defaults to the caller.",
    mcp: true,
    write: true,
  }),
  "sessions.update": op({
    input: z.object({
      id,
      patch: z
        .object({
          typeId: id,
          startsAt: isoDateTime,
          durationMinutes: z.number().int().min(1).max(24 * 60),
          staffUid: id,
          helpCategoryIds: z.array(id).max(20),
          notes: longText,
          locationId: id.or(z.literal("")),
          locationOther: shortText,
          status: z.enum(["scheduled", "completed", "cancelled", "did_not_attend"]),
        })
        .partial(),
    }),
    permission: "sessions.manage",
    description: "Update a session.",
    mcp: true,
    write: true,
  }),

  // Callbacks
  "callbacks.list": op({
    input: z.object({
      clientId: id.optional(),
      assigneeUid: z.union([id, z.literal("me")]).optional(),
      status: z.enum(["open", "done", "cancelled"]).optional(),
      dueBefore: isoDateTime.optional(),
      limit,
    }),
    permission: "clients.view",
    description: "List callbacks for a client or assignee.",
    mcp: true,
    write: false,
  }),
  "callbacks.create": op({
    input: z.object({ clientId: id, assigneeUid: id.optional(), dueAt: isoDateTime, reason: z.string().trim().min(1).max(1000) }),
    permission: "callbacks.manage",
    description: "Create a callback (a scheduled follow up). Assignee defaults to the caller.",
    mcp: true,
    write: true,
  }),
  "callbacks.update": op({
    input: z.object({
      id,
      patch: z
        .object({
          assigneeUid: id,
          dueAt: isoDateTime,
          reason: z.string().trim().min(1).max(1000),
          status: z.enum(["open", "done", "cancelled"]),
        })
        .partial(),
    }),
    permission: "callbacks.manage",
    description: "Update a callback, for example mark it done.",
    mcp: true,
    write: true,
  }),

  // Notes and files
  "notes.list": op({
    input: z.object({ clientId: id, limit }),
    permission: "clients.view",
    description: "List notes on a client, newest first.",
    mcp: true,
    write: false,
  }),
  "notes.create": op({
    input: z.object({
      clientId: id,
      body: z.string().trim().min(1).max(20_000),
      linkedTo: z.object({ kind: z.enum(["session", "callback", "outcome"]), id }).optional(),
    }),
    permission: "clients.edit",
    description: "Add a note to a client, optionally linked to a session, callback or outcome.",
    mcp: true,
    write: true,
  }),
  "notes.update": op({
    input: z.object({ id, body: z.string().trim().min(1).max(20_000) }),
    permission: "clients.edit",
    description: "Edit a note.",
    mcp: true,
    write: true,
  }),
  "files.list": op({
    input: z.object({ clientId: id }),
    permission: "clients.view",
    description: "List files attached to a client and their notes, sessions and callbacks.",
    mcp: true,
    write: false,
  }),
  "files.createUpload": op({
    input: z.object({
      clientId: id,
      parent: z.object({ kind: z.enum(["client", "note", "session", "callback"]), id }),
      fileName: z.string().trim().min(1).max(200),
      contentType: z.string().max(100),
      sizeBytes: z.number().int().min(1).max(25 * 1024 * 1024),
      description: z.string().trim().min(1).max(1000),
    }),
    permission: "files.upload",
    description: "Start a file upload. Returns a short lived URL to PUT the file to.",
    mcp: false,
    write: true,
  }),
  "files.completeUpload": op({
    input: z.object({ id }),
    permission: "files.upload",
    description: "Confirm a file upload has finished.",
    mcp: false,
    write: true,
  }),
  "files.getDownloadUrl": op({
    input: z.object({ id }),
    permission: "clients.view",
    description: "Get a short lived URL to download a file.",
    mcp: false,
    write: false,
  }),

  // Outcomes
  "outcomes.list": op({
    input: z.object({ clientId: id }),
    permission: "clients.view",
    description: "List outcomes recorded for a client.",
    mcp: true,
    write: false,
  }),
  "outcomes.record": op({
    input: z.object({
      clientId: id,
      setId: id,
      helpCategoryId: id,
      sessionId: id.optional(),
      perspective: z.enum(["client", "staff"]),
      answers,
    }),
    permission: "outcomes.record",
    description: "Record an outcome measure for a client against a help category, from the client's or the staff view.",
    mcp: true,
    write: true,
  }),

  // Consent
  "consents.list": op({
    input: z.object({ clientId: id }),
    permission: "clients.view",
    description: "List consent records for a client.",
    mcp: true,
    write: false,
  }),
  "consents.record": op({
    input: z.object({
      clientId: id,
      purpose: z.enum(Object.keys(CONSENT_PURPOSES) as [keyof typeof CONSENT_PURPOSES]),
      method: z.enum(["verbal", "written", "electronic"]),
      givenAt: isoDateTime,
      notes: z.string().trim().max(1000).optional(),
    }),
    permission: "consent.manage",
    description: "Record that a client gave consent.",
    mcp: false,
    write: true,
  }),
  "consents.withdraw": op({
    input: z.object({ id, notes: z.string().trim().max(1000).optional() }),
    permission: "consent.manage",
    description: "Record that a client withdrew a consent. Applies the matching restriction to the client.",
    mcp: false,
    write: true,
  }),

  // Safeguarding
  "safeguarding.list": op({
    input: z.object({ clientId: id.optional(), status: z.enum(SAFEGUARDING_STATUSES).optional(), openOnly: z.boolean().default(false) }),
    permission: "safeguarding.view",
    description: "List safeguarding concerns.",
    mcp: false,
    write: false,
  }),
  "safeguarding.raise": op({
    input: z.object({ clientId: id, description: z.string().trim().min(1).max(10_000), severity: z.enum(SAFEGUARDING_SEVERITIES) }),
    permission: "safeguarding.raise",
    description: "Raise a safeguarding concern about a client.",
    mcp: true,
    write: true,
  }),
  "safeguarding.update": op({
    input: z.object({
      id,
      status: z.enum(SAFEGUARDING_STATUSES).optional(),
      leadUid: id.optional(),
      severity: z.enum(SAFEGUARDING_SEVERITIES).optional(),
      comment: z.string().trim().max(10_000).optional(),
    }),
    permission: "safeguarding.manage",
    description: "Change the status, lead or severity of a concern, or add a comment.",
    mcp: false,
    write: true,
  }),

  // Reports
  "reports.outcomes": op({
    input: z.object({ setId: id, filters: reportFiltersSchema.default({}), dimension }),
    permission: "reports.view",
    description: "Outcome results for an outcome measure, split by a dimension such as town or help category.",
    mcp: true,
    write: false,
  }),
  "reports.demand": op({
    input: z.object({ filters: reportFiltersSchema.default({}), dimension }),
    permission: "reports.view",
    description: "Which types of help are most needed: clients, sessions and hours per help category.",
    mcp: true,
    write: false,
  }),
  "reports.activity": op({
    input: z.object({ filters: reportFiltersSchema.default({}), dimension }),
    permission: "reports.view",
    description: "Sessions and callbacks completed, and callbacks overdue.",
    mcp: true,
    write: false,
  }),
  "reports.exportCsv": op({
    input: z.object({
      report: z.enum(["outcomes", "demand", "activity"]),
      setId: id.optional(),
      filters: reportFiltersSchema.default({}),
      dimension,
    }),
    permission: "reports.view",
    description: "Export a report as CSV.",
    mcp: false,
    write: false,
  }),

  // Users and roles
  "users.list": op({
    input: z.object({ includeInactive: z.boolean().default(true) }),
    permission: "users.manage",
    description: "List users with their roles.",
    mcp: false,
    write: false,
  }),
  "users.invite": op({
    input: z.object({ email: z.email(), displayName: shortText.optional(), roleIds: z.array(id).max(20) }),
    permission: "users.manage",
    description: "Invite a user by Google account email.",
    mcp: false,
    write: true,
  }),
  "users.update": op({
    input: z.object({ uid: id, roleIds: z.array(id).max(20).optional(), active: z.boolean().optional(), displayName: shortText.optional() }),
    permission: "users.manage",
    description: "Change a user's roles or deactivate them. Users are never deleted.",
    mcp: false,
    write: true,
  }),
  "roles.list": op({
    input: z.object({}),
    permission: "authenticated",
    description: "List roles and their permissions.",
    mcp: false,
    write: false,
  }),
  "roles.upsert": op({
    input: z.object({
      id: id.optional(),
      name: shortText.min(1),
      description: z.string().trim().max(500).optional(),
      permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])),
    }),
    permission: "users.manage",
    description: "Create or update a role.",
    mcp: false,
    write: true,
  }),
  "roles.delete": op({
    input: z.object({ id }),
    permission: "users.manage",
    description: "Delete a role that no user holds. The super user role cannot be deleted.",
    mcp: false,
    write: true,
  }),

  // Organisation settings
  "org.updateSettings": op({
    input: z
      .object({
        name: shortText.min(1),
        retentionMonths: z.number().int().min(1).max(240),
        retentionWarningDays: z.number().int().min(1).max(365),
        allowedDomains: z.array(z.string().trim().toLowerCase().max(200)).max(20),
        sessionTimeoutMinutes: z.number().int().min(5).max(24 * 60),
        reminderLeadHours: z.number().int().min(1).max(24 * 14),
        calendarSyncEnabled: z.boolean(),
        quorumMinimum: z.number().int().min(1).max(100),
        quorumFraction: z.number().min(0).max(1),
      })
      .partial(),
    permission: "config.manage",
    description: "Update organisation settings.",
    mcp: false,
    write: true,
  }),

  // Audit and retention
  "audit.list": op({
    input: z.object({
      clientId: id.optional(),
      actorUid: id.optional(),
      entity: shortText.optional(),
      from: isoDateTime.optional(),
      to: isoDateTime.optional(),
      limit,
      cursor: z.string().max(200).optional(),
    }),
    permission: "audit.view",
    description: "Search the audit log.",
    mcp: false,
    write: false,
  }),
  "audit.clientAccess": op({
    input: z.object({ clientId: id, from: isoDateTime.optional(), to: isoDateTime.optional() }),
    permission: ["audit.view", "safeguarding.manage"],
    description: "Safeguarding audit report: who accessed a client's records and when.",
    mcp: false,
    write: false,
  }),
  "retention.upcoming": op({
    input: z.object({}),
    permission: "retention.manage",
    description: "Clients due for anonymisation within the warning period.",
    mcp: false,
    write: false,
  }),

  // Personal access tokens (MCP) and calendar
  "tokens.list": op({
    input: z.object({}),
    permission: "mcp.use",
    description: "List your personal access tokens.",
    mcp: false,
    write: false,
  }),
  "tokens.create": op({
    input: z.object({ name: shortText.min(1), expiresInDays: z.number().int().min(1).max(365).default(90) }),
    permission: "mcp.use",
    description: "Create a personal access token for the MCP server. The token is shown once.",
    mcp: false,
    write: true,
  }),
  "tokens.revoke": op({
    input: z.object({ id }),
    permission: "mcp.use",
    description: "Revoke a personal access token.",
    mcp: false,
    write: true,
  }),
  "calendar.connectUrl": op({
    input: z.object({ returnTo: z.string().max(500).optional() }),
    permission: "authenticated",
    description: "Get the Google consent URL to connect your calendar.",
    mcp: false,
    write: false,
  }),
  "calendar.disconnect": op({
    input: z.object({}),
    permission: "authenticated",
    description: "Disconnect your Google Calendar.",
    mcp: false,
    write: true,
  }),

  // Trust meetings
  "trustees.list": op({
    input: z.object({ includeInactive: z.boolean().default(false) }),
    permission: "meetings.view",
    description: "List trustees and board members. Former trustees are included when asked.",
    mcp: true,
    write: false,
  }),
  "trustees.upsert": op({
    input: trusteeSchema,
    permission: "meetings.manage",
    description: "Add a trustee, or update one when an id is given. Trustees are never deleted; set an end date when they stand down.",
    mcp: false,
    write: true,
  }),
  "meetings.list": op({
    input: z.object({ from: isoDateTime.optional(), to: isoDateTime.optional(), limit }),
    permission: "meetings.view",
    description: "List trust meetings between two dates, soonest first.",
    mcp: true,
    write: false,
  }),
  "meetings.get": op({
    input: z.object({ id }),
    permission: "meetings.view",
    description:
      "Get a meeting with its agenda, minutes, register, quorum, the actions raised at it, open actions from earlier meetings and its papers.",
    mcp: true,
    write: false,
  }),
  "meetings.create": op({
    input: meetingFields.extend({
      agenda: meetingFields.shape.agenda.default([]),
    }),
    permission: "meetings.manage",
    description: "Schedule a trust meeting, optionally with its agenda.",
    mcp: true,
    write: true,
  }),
  "meetings.update": op({
    input: z.object({ id, patch: meetingFields.partial() }),
    permission: "meetings.manage",
    description: "Update a meeting's details, agenda or minutes. Approved minutes can't be changed.",
    mcp: true,
    write: true,
  }),
  "meetings.setRegister": op({
    input: z.object({
      id,
      attendance: z.array(z.object({ trusteeId: id, status: z.enum(ATTENDANCE_STATUSES) })).max(100),
      guests: z.array(z.object({ name: shortText.min(1), organisation: shortText.optional() })).max(50).default([]),
      staffUids: z.array(id).max(50).default([]),
    }),
    permission: "meetings.manage",
    description: "Record who attended a meeting: trustees present, sending apologies or absent, guests and staff.",
    mcp: true,
    write: true,
  }),
  "meetings.approveMinutes": op({
    input: z.object({ id, atMeetingId: id.optional() }),
    permission: "meetings.manage",
    description: "Mark a meeting's minutes as approved, usually at a later meeting. Approved minutes are locked.",
    mcp: false,
    write: true,
  }),
  "meetings.reopenMinutes": op({
    input: z.object({ id, reason: z.string().trim().min(1).max(1000) }),
    permission: "meetings.manage",
    description: "Return approved minutes to draft so a correction can be made. The reason is kept in the audit log.",
    mcp: false,
    write: true,
  }),
  "meetingActions.list": op({
    input: z.object({
      meetingId: id.optional(),
      status: z.enum(["open", "done"]).optional(),
      mine: z.boolean().default(false),
      overdue: z.boolean().default(false),
      limit,
    }),
    permission: "meetings.view",
    description: "List actions from trust meetings. Filter by meeting, status, your own or overdue.",
    mcp: true,
    write: false,
  }),
  "meetingActions.create": op({
    input: z.object({ meetingId: id, ...actionFields.shape }),
    permission: "meetings.manage",
    description: "Record an action raised at a meeting, with an owner and due date.",
    mcp: true,
    write: true,
  }),
  "meetingActions.update": op({
    input: z.object({
      id,
      patch: actionFields.partial().extend({ status: z.enum(["open", "done"]).optional() }),
      /** The meeting at which it was reported done. */
      atMeetingId: id.optional(),
    }),
    permission: "meetings.manage",
    description: "Update an action, for example mark it done at a meeting.",
    mcp: true,
    write: true,
  }),
  "meetingPapers.createUpload": op({
    input: z.object({
      meetingId: id,
      fileName: z.string().trim().min(1).max(200),
      contentType: z.string().max(100),
      sizeBytes: z.number().int().min(1).max(25 * 1024 * 1024),
      description: z.string().trim().min(1).max(1000),
    }),
    permission: "meetings.manage",
    description: "Start uploading a paper for a meeting. Returns a short lived URL to send the file to.",
    mcp: false,
    write: true,
  }),
  "meetingPapers.completeUpload": op({
    input: z.object({ id }),
    permission: "meetings.manage",
    description: "Confirm a meeting paper upload has finished.",
    mcp: false,
    write: true,
  }),
  "meetingPapers.getDownloadUrl": op({
    input: z.object({ id }),
    permission: "meetings.view",
    description: "Get a short lived URL to download a meeting paper.",
    mcp: false,
    write: false,
  }),
} as const;

export type OpName = keyof typeof ops;
export type OpInput<N extends OpName> = z.input<(typeof ops)[N]["input"]>;
export type OpParsedInput<N extends OpName> = z.output<(typeof ops)[N]["input"]>;

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface ClientExport {
  exportedAt: D.ISODate;
  client: D.Client;
  answers: D.AnswerSet[];
  sessions: D.Session[];
  callbacks: D.Callback[];
  notes: D.Note[];
  files: (D.FileRecord & { downloadUrl?: string })[];
  outcomes: D.Outcome[];
  consents: D.ConsentRecord[];
  safeguarding: D.SafeguardingConcern[];
}

export interface Dashboard {
  overdueCallbacks: (D.Callback & { clientName: string })[];
  upcomingCallbacks: (D.Callback & { clientName: string })[];
  upcomingSessions: (D.Session & { clientName: string })[];
  notifications: D.Notification[];
  openSafeguarding?: number;
  retentionDue?: number;
  /** Open meeting actions past their due date. Only for people who can see meetings. */
  overdueMeetingActions?: number;
}

export interface MeetingDetail {
  meeting: D.Meeting;
  quorum: D.Quorum;
  /** Everyone named on the register: trustees serving on the day plus any former trustee recorded. */
  trustees: D.Trustee[];
  /** Actions raised at this meeting. */
  actions: D.MeetingAction[];
  /** Actions from earlier meetings still open, to review at this one. */
  carriedForward: D.MeetingAction[];
  /** Earlier actions reported done at this meeting. */
  completedHere: D.MeetingAction[];
  papers: D.MeetingPaper[];
  /** Title and date of the meeting that approved these minutes. */
  approvedAtMeeting?: { id: string; title: string; startsAt: D.ISODate };
}

/** What each operation returns. */
export interface OpOutputs {
  "me.get": D.Me;
  "dashboard.get": Dashboard;
  "notifications.markRead": { ok: true };
  "users.directory": { uid: string; displayName: string }[];
  "clients.list": Page<D.ClientSummary>;
  "clients.get": D.Client;
  "clients.create": D.Client;
  "clients.update": D.Client;
  "clients.setQuestionSet": D.Client;
  "clients.export": ClientExport;
  "clients.anonymise": { ok: true };
  "questions.list": D.Question[];
  "questions.upsert": D.Question;
  "questionSets.list": D.QuestionSet[];
  "questionSets.upsert": D.QuestionSet;
  "answers.get": { current: D.AnswerSet | null; history: D.AnswerSet[] };
  "answers.save": D.AnswerSet;
  "helpCategories.list": D.HelpCategory[];
  "helpCategories.upsert": D.HelpCategory;
  "sessionTypes.list": D.SessionType[];
  "sessionTypes.upsert": D.SessionType;
  "sessionLocations.list": D.SessionLocation[];
  "sessionLocations.upsert": D.SessionLocation;
  "sessionLocations.otherValues": D.OtherLocationUsage[];
  "sessionLocations.promoteOther": { moved: number };
  /** clientName is filled in when the list isn't for a single client. */
  "sessions.list": (D.Session & { clientName?: string })[];
  "sessions.create": D.Session;
  "sessions.update": D.Session;
  "callbacks.list": (D.Callback & { clientName?: string })[];
  "callbacks.create": D.Callback;
  "callbacks.update": D.Callback;
  "notes.list": D.Note[];
  "notes.create": D.Note;
  "notes.update": D.Note;
  "files.list": D.FileRecord[];
  /** Send the file body to uploadUrl with uploadMethod and exactly these headers. */
  "files.createUpload": { file: D.FileRecord; uploadUrl: string; uploadMethod: "PUT" | "POST"; uploadHeaders: Record<string, string> };
  "files.completeUpload": D.FileRecord;
  "files.getDownloadUrl": { url: string; expiresAt: D.ISODate };
  "outcomes.list": D.Outcome[];
  "outcomes.record": D.Outcome;
  "consents.list": D.ConsentRecord[];
  "consents.record": D.ConsentRecord;
  "consents.withdraw": D.ConsentRecord;
  "safeguarding.list": D.SafeguardingConcern[];
  "safeguarding.raise": D.SafeguardingConcern;
  "safeguarding.update": D.SafeguardingConcern;
  "reports.outcomes": D.ReportResult;
  "reports.demand": D.ReportResult;
  "reports.activity": D.ReportResult;
  "reports.exportCsv": { fileName: string; csv: string };
  "users.list": D.UserRecord[];
  "users.invite": D.UserRecord;
  "users.update": D.UserRecord;
  "roles.list": D.Role[];
  "roles.upsert": D.Role;
  "roles.delete": { ok: true };
  "org.updateSettings": D.OrgSettings;
  "audit.list": Page<D.AuditEntry>;
  "audit.clientAccess": {
    clientId: string;
    entries: { actorUid: string; actorName: string; channel: D.Channel; action: D.AuditAction; entity: string; at: D.ISODate }[];
    byUser: { actorUid: string; actorName: string; count: number; firstAt: D.ISODate; lastAt: D.ISODate }[];
  };
  "retention.upcoming": D.RetentionCandidate[];
  "tokens.list": D.ApiTokenSummary[];
  "tokens.create": { token: string; summary: D.ApiTokenSummary };
  "tokens.revoke": { ok: true };
  "calendar.connectUrl": { url: string };
  "calendar.disconnect": { ok: true };
  "trustees.list": D.Trustee[];
  "trustees.upsert": D.Trustee;
  "meetings.list": D.Meeting[];
  "meetings.get": MeetingDetail;
  "meetings.create": D.Meeting;
  "meetings.update": D.Meeting;
  "meetings.setRegister": D.Meeting;
  "meetings.approveMinutes": D.Meeting;
  "meetings.reopenMinutes": D.Meeting;
  "meetingActions.list": (D.MeetingAction & { meetingTitle?: string })[];
  "meetingActions.create": D.MeetingAction;
  "meetingActions.update": D.MeetingAction;
  /** Send the file body to uploadUrl with uploadMethod and exactly these headers. */
  "meetingPapers.createUpload": { paper: D.MeetingPaper; uploadUrl: string; uploadMethod: "PUT" | "POST"; uploadHeaders: Record<string, string> };
  "meetingPapers.completeUpload": D.MeetingPaper;
  "meetingPapers.getDownloadUrl": { url: string; expiresAt: D.ISODate };
}

// Compile time check that every op has an output type and vice versa.
type _Missing = Exclude<OpName, keyof OpOutputs> | Exclude<keyof OpOutputs, OpName>;
const _check: [_Missing] extends [never] ? true : _Missing = true;
void _check;

export type OpOutput<N extends OpName> = OpOutputs[N];

export interface ApiRequest<N extends OpName = OpName> {
  op: N;
  input: OpInput<N>;
}

/** Error codes returned by the API, matching Firebase HttpsError codes. */
export type ApiErrorCode =
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "invalid-argument"
  | "failed-precondition"
  | "already-exists"
  | "internal";
