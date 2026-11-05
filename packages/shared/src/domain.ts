/**
 * Domain records as they travel over the API. Dates are ISO 8601 strings.
 * Firestore documents hold the same shapes with Timestamps in place of strings.
 */
import type { Permission } from "./permissions.js";

export type ISODate = string;
/** Where a call came from. "integration" is a server, such as the charity's website, using an integration key. */
export type Channel = "ui" | "mcp" | "system" | "integration";

export const CONTACT_METHODS = ["phone", "email", "post", "in_person", "text"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export interface PhoneNumber {
  label: string;
  number: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone?: string;
  email?: string;
  isNextOfKin: boolean;
}

export type ClientStatus = "active" | "restricted" | "anonymised";

export interface ClientSummary {
  id: string;
  status: ClientStatus;
  firstName: string;
  lastName: string;
  preferredName?: string;
  town?: string;
  postcodeDistrict?: string;
  helpCategoryIds: string[];
  /** Only populated for users with safeguarding.view. */
  openSafeguardingConcerns?: number;
  lastActivityAt?: ISODate;
}

export interface Client extends ClientSummary {
  dateOfBirth?: string; // YYYY-MM-DD
  addressLines: string[];
  postcode?: string;
  phones: PhoneNumber[];
  email?: string;
  preferredContactMethod?: ContactMethod;
  contacts: EmergencyContact[];
  /** Question set ids attached to this client. */
  questionSetIds: string[];
  /** Restrictions in force because consent was withdrawn. */
  restrictions: ConsentRestriction[];
  createdAt: ISODate;
  createdBy: string;
  updatedAt: ISODate;
  anonymisedAt?: ISODate;
}

// Questionnaires and outcome measures

export const QUESTION_TYPES = ["text", "yes_no", "single_choice", "multiple_choice", "number", "date", "scale"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface Question {
  id: string;
  text: string;
  helpText?: string;
  type: QuestionType;
  /** For single_choice and multiple_choice. */
  options?: string[];
  /** For scale: inclusive bounds and optional end labels. */
  scale?: { min: number; max: number; minLabel?: string; maxLabel?: string };
  archived: boolean;
}

export type QuestionSetKind = "questionnaire" | "outcome";

export interface QuestionSet {
  id: string;
  name: string;
  description?: string;
  kind: QuestionSetKind;
  sensitive: boolean;
  questionIds: string[];
  /** Questionnaire sets attached to every new client automatically. */
  attachByDefault: boolean;
  archived: boolean;
}

export type AnswerValue = string | number | boolean | string[] | null;

export interface AnswerSet {
  id: string;
  clientId: string;
  setId: string;
  version: number;
  answers: Record<string, AnswerValue>;
  recordedBy: string;
  recordedAt: ISODate;
}

// Managed lists

export interface HelpCategory {
  id: string;
  name: string;
  description?: string;
  archived: boolean;
}

/**
 * Where an in-person session takes place, from a managed list. One entry is
 * marked as "Other", and choosing it asks for a short description. Those
 * descriptions can later be promoted to their own list entry.
 */
export interface SessionLocation {
  id: string;
  name: string;
  isOther: boolean;
  archived: boolean;
}

/** A free text "Other" location and how many sessions use it. */
export interface OtherLocationUsage {
  text: string;
  sessions: number;
  lastUsedAt: ISODate;
}

export interface SessionType {
  id: string;
  name: string;
  inPerson: boolean;
  archived: boolean;
}

// Sessions, callbacks, notes, files

export type SessionStatus = "scheduled" | "completed" | "cancelled" | "did_not_attend";

export interface Session {
  id: string;
  clientId: string;
  typeId: string;
  startsAt: ISODate;
  durationMinutes: number;
  staffUid: string;
  helpCategoryIds: string[];
  notes?: string;
  /** Managed location, for in-person sessions. */
  locationId?: string;
  /** Description when the location is the "Other" entry. Removed on anonymisation. */
  locationOther?: string;
  status: SessionStatus;
  createdAt: ISODate;
  createdBy: string;
}

export type CallbackStatus = "open" | "done" | "cancelled";

export interface Callback {
  id: string;
  clientId: string;
  assigneeUid: string;
  dueAt: ISODate;
  reason: string;
  status: CallbackStatus;
  completedAt?: ISODate;
  createdAt: ISODate;
  createdBy: string;
}

export type LinkedRecordKind = "session" | "callback" | "outcome";

export interface Note {
  id: string;
  clientId: string;
  body: string;
  linkedTo?: { kind: LinkedRecordKind; id: string };
  createdAt: ISODate;
  createdBy: string;
  updatedAt?: ISODate;
}

export type FileParentKind = "client" | "note" | "session" | "callback";

export interface FileRecord {
  id: string;
  clientId: string;
  parent: { kind: FileParentKind; id: string };
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** What the file relates to, in the uploader's words. */
  description: string;
  status: "pending" | "ready";
  createdAt: ISODate;
  createdBy: string;
}

// Outcomes

export type OutcomePerspective = "client" | "staff";

export interface Outcome {
  id: string;
  clientId: string;
  setId: string;
  helpCategoryId: string;
  sessionId?: string;
  perspective: OutcomePerspective;
  answers: Record<string, AnswerValue>;
  recordedAt: ISODate;
  recordedBy: string;
}

// Safeguarding

export const SAFEGUARDING_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SafeguardingSeverity = (typeof SAFEGUARDING_SEVERITIES)[number];
export const SAFEGUARDING_STATUSES = ["open", "under_review", "escalated", "closed"] as const;
export type SafeguardingStatus = (typeof SAFEGUARDING_STATUSES)[number];

export interface SafeguardingAction {
  at: ISODate;
  by: string;
  kind: "raised" | "status_changed" | "assigned" | "comment";
  status?: SafeguardingStatus;
  leadUid?: string;
  comment?: string;
}

export interface SafeguardingConcern {
  id: string;
  clientId: string;
  description: string;
  severity: SafeguardingSeverity;
  status: SafeguardingStatus;
  raisedBy: string;
  raisedAt: ISODate;
  leadUid?: string;
  history: SafeguardingAction[];
}

// Consent

export const CONSENT_PURPOSES = {
  data_processing: "Store and use the client's personal data to provide support",
  sensitive_data: "Record health and financial information (special category data)",
  contact: "Contact the client by their preferred method",
  share_with_partners: "Share information with partner organisations when referring",
} as const;
export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;

export type ConsentMethod = "verbal" | "written" | "electronic";

/** What the system restricts when a given consent is withdrawn. */
export type ConsentRestriction = "no_processing" | "no_sensitive_data" | "no_contact" | "no_sharing";

export const RESTRICTION_FOR_PURPOSE: Record<ConsentPurpose, ConsentRestriction> = {
  data_processing: "no_processing",
  sensitive_data: "no_sensitive_data",
  contact: "no_contact",
  share_with_partners: "no_sharing",
};

export interface ConsentRecord {
  id: string;
  clientId: string;
  purpose: ConsentPurpose;
  method: ConsentMethod;
  givenAt: ISODate;
  recordedBy: string;
  notes?: string;
  withdrawnAt?: ISODate;
  withdrawnBy?: string;
  withdrawalNotes?: string;
}

// Users and roles

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: Permission[];
  system: boolean;
}

export interface UserRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  roleIds: string[];
  active: boolean;
  /** True when the user was invited but has not signed in yet. */
  invited: boolean;
  calendarConnected: boolean;
  createdAt: ISODate;
  lastSeenAt?: ISODate;
}

export interface Me {
  user: UserRecord;
  permissions: Permission[];
  org: OrgSettings;
}

export interface OrgSettings {
  name: string;
  /** Months after last activity before a client is anonymised. */
  retentionMonths: number;
  /** How far ahead managers are warned about upcoming anonymisation. */
  retentionWarningDays: number;
  /** Google Workspace domains whose users may sign in. Empty means invite only. */
  allowedDomains: string[];
  sessionTimeoutMinutes: number;
  /** Hours before a callback is due that a reminder is sent. */
  reminderLeadHours: number;
  calendarSyncEnabled: boolean;
  /** Days after a referral is accepted or declined before its personal details are removed. */
  referralRetentionDays: number;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  name: "Our charity",
  retentionMonths: 36,
  retentionWarningDays: 60,
  allowedDomains: [],
  sessionTimeoutMinutes: 30,
  reminderLeadHours: 24,
  calendarSyncEnabled: false,
  referralRetentionDays: 90,
};

export interface Notification {
  id: string;
  userUid: string;
  kind: "callback_due" | "callback_overdue" | "safeguarding_assigned" | "retention_upcoming" | "referral_assigned";
  message: string;
  link?: string;
  createdAt: ISODate;
  readAt?: ISODate;
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  createdAt: ISODate;
  lastUsedAt?: ISODate;
  expiresAt: ISODate;
  revokedAt?: ISODate;
}

// Referrals

export const REFERRAL_STATUSES = ["new", "contacted", "accepted", "declined"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRER_TYPES = ["self", "family_or_friend", "professional"] as const;
export type ReferrerType = (typeof REFERRER_TYPES)[number];

/**
 * A referral sent in from outside, usually the charity's website. It waits in
 * a triage queue until someone accepts it (which creates or links a client)
 * or declines it. Personal details are removed a set time after that decision.
 */
export interface Referral {
  id: string;
  /** Short reference shown to the person who referred, such as R-7K3Q9X. */
  reference: string;
  status: ReferralStatus;
  /** Name of the integration key it came in on, such as "Website". */
  source: string;
  referrerType: ReferrerType;
  referrerName?: string;
  referrerRelationship?: string;
  referrerOrganisation?: string;
  referrerPhone?: string;
  referrerEmail?: string;
  firstName: string;
  lastName: string;
  addressLine?: string;
  town?: string;
  postcode?: string;
  postcodeDistrict?: string;
  phone?: string;
  email?: string;
  preferredContactMethod?: ContactMethod;
  helpNeeded: string;
  helpCategoryHints: string[];
  /** Whether the person knows about this referral. Always true for self referrals. */
  personAware: boolean;
  consentToContact: boolean;
  heardAbout?: string;
  sourceUrl?: string;
  assigneeUid?: string;
  /** Staff notes made while triaging. */
  notes?: string;
  declineReason?: string;
  clientId?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  decidedAt?: ISODate;
  decidedBy?: string;
  /** Set when personal details were removed under the retention policy. */
  anonymisedAt?: ISODate;
}

export interface ReferralSummary {
  id: string;
  reference: string;
  status: ReferralStatus;
  source: string;
  referrerType: ReferrerType;
  displayName: string;
  town?: string;
  postcodeDistrict?: string;
  helpCategoryHints: string[];
  assigneeUid?: string;
  createdAt: ISODate;
  anonymisedAt?: ISODate;
}

/** An existing client that might be the same person as a referral. */
export interface PossibleDuplicate {
  clientId: string;
  displayName: string;
  town?: string;
  postcodeDistrict?: string;
  /** What matched, for example "name and postcode". */
  reason: string;
}

export interface IntegrationKeySummary {
  id: string;
  name: string;
  /** Label stored on every referral sent with this key, such as "Website". */
  source: string;
  /** Most referrals accepted from this key in one hour. */
  hourlyLimit: number;
  createdAt: ISODate;
  createdBy: string;
  lastUsedAt?: ISODate;
  revokedAt?: ISODate;
}

// Audit

export type AuditAction =
  | "read"
  | "list"
  | "create"
  | "update"
  | "delete"
  | "export"
  | "download"
  | "anonymise"
  | "sign_in"
  | "token_created"
  | "token_revoked"
  | "denied";

export interface AuditEntry {
  id: string;
  at: ISODate;
  actorUid: string;
  actorEmail?: string;
  channel: Channel;
  action: AuditAction;
  entity: string;
  entityId?: string;
  clientId?: string;
  op?: string;
  /** Before and after values. Null when the client has since been anonymised and the values were shredded. */
  diff?: { before?: unknown; after?: unknown } | null;
  /** True when values exist but the viewer lacks the permission to see them. */
  diffHidden?: boolean;
  detail?: string;
}

// Reports

export const REPORT_DIMENSIONS = [
  "town",
  "postcodeDistrict",
  "location",
  "helpCategory",
  "sessionType",
  "staff",
  "month",
] as const;
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];

export interface ReportRow {
  key: string;
  label: string;
  values: Record<string, number>;
}

export interface ReportResult {
  title: string;
  dimension: ReportDimension | null;
  columns: { key: string; label: string }[];
  rows: ReportRow[];
  generatedAt: ISODate;
  notes?: string[];
}

export interface RetentionCandidate {
  clientId: string;
  displayName: string;
  lastActivityAt: ISODate;
  anonymiseAfter: ISODate;
  heldBySafeguarding: boolean;
}
