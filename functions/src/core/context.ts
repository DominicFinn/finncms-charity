/**
 * Works out who is calling and what they may do.
 *
 * Access is granted only to people who have been invited, who belong to an
 * allowed Google Workspace domain, or who are the bootstrap super user named
 * in configuration. Deactivated users are refused.
 */
import {
  DEFAULT_ORG_SETTINGS,
  SUPER_USER_ROLE_ID,
  type Channel,
  type OrgSettings,
  type Permission,
  ALL_PERMISSIONS,
} from "@ccm/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auditNow, type Actor } from "./audit.js";
import { fail } from "./errors.js";
import { C, db } from "./firebase.js";

export interface UserDoc {
  email: string;
  displayName: string;
  photoURL?: string;
  roleIds: string[];
  active: boolean;
  invited: boolean;
  calendarConnected?: boolean;
  createdAt: Timestamp;
  lastSeenAt?: Timestamp;
}

export interface Ctx extends Actor {
  user: UserDoc;
  permissions: Set<Permission>;
  org: OrgSettings;
  can(p: Permission): boolean;
  /** Clients whose data the current read touched; written to the audit log by the dispatcher. */
  touched: Set<string>;
}

export interface Caller {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  provider?: string;
}

export async function getOrgSettings(): Promise<OrgSettings> {
  const snap = await db.collection(C.config).doc("org").get();
  return { ...DEFAULT_ORG_SETTINGS, ...(snap.data() as Partial<OrgSettings> | undefined) };
}

export async function permissionsFor(roleIds: string[]): Promise<Set<Permission>> {
  if (roleIds.includes(SUPER_USER_ROLE_ID)) return new Set(ALL_PERMISSIONS);
  if (roleIds.length === 0) return new Set();
  const refs = roleIds.map((id) => db.collection(C.roles).doc(id));
  const snaps = await db.getAll(...refs);
  const perms = new Set<Permission>();
  for (const snap of snaps) {
    for (const p of (snap.get("permissions") as Permission[] | undefined) ?? []) perms.add(p);
  }
  return perms;
}

async function superUserExists(): Promise<boolean> {
  const q = await db
    .collection(C.users)
    .where("roleIds", "array-contains", SUPER_USER_ROLE_ID)
    .where("active", "==", true)
    .limit(1)
    .get();
  return !q.empty;
}

/** Turns an invite, an allowed domain or the bootstrap email into a user record. */
async function provision(caller: Caller, org: OrgSettings): Promise<UserDoc | null> {
  const email = caller.email!.toLowerCase();
  const usersRef = db.collection(C.users);
  const base = {
    email,
    displayName: caller.name ?? email,
    photoURL: caller.picture,
    active: true,
    invited: false,
    calendarConnected: false,
    createdAt: Timestamp.now(),
    lastSeenAt: Timestamp.now(),
  };

  const invites = await usersRef.where("email", "==", email).where("invited", "==", true).limit(1).get();
  if (!invites.empty) {
    const invite = invites.docs[0];
    const doc: UserDoc = {
      ...base,
      displayName: (invite.get("displayName") as string | undefined) || base.displayName,
      roleIds: invite.get("roleIds") ?? [],
      active: invite.get("active") !== false,
      createdAt: invite.get("createdAt") ?? base.createdAt,
    };
    await db.runTransaction(async (tx) => {
      tx.create(usersRef.doc(caller.uid), doc);
      tx.delete(invite.ref);
    });
    return doc;
  }

  const bootstrap = process.env.BOOTSTRAP_SUPERUSER_EMAIL?.toLowerCase().trim();
  if (bootstrap && bootstrap === email && !(await superUserExists())) {
    const doc: UserDoc = { ...base, roleIds: [SUPER_USER_ROLE_ID] };
    await usersRef.doc(caller.uid).create(doc);
    return doc;
  }

  const domain = email.split("@")[1];
  if (domain && org.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
    const doc: UserDoc = { ...base, roleIds: [] };
    await usersRef.doc(caller.uid).create(doc);
    return doc;
  }

  return null;
}

export async function resolveCaller(caller: Caller, channel: Channel): Promise<Ctx> {
  if (!caller.email) throw fail.unauthenticated("Your account has no email address.");
  if (channel === "ui") {
    if (caller.provider !== "google.com") throw fail.unauthenticated("Please sign in with Google.");
    if (caller.emailVerified === false) throw fail.unauthenticated("Your Google email address is not verified.");
  }

  const org = await getOrgSettings();
  const ref = db.collection(C.users).doc(caller.uid);
  let snap = await ref.get();
  let user = snap.exists ? (snap.data() as UserDoc) : null;
  if (!user) {
    user = await provision(caller, org);
    if (!user) {
      await auditNow(
        { uid: caller.uid, email: caller.email, channel },
        { action: "denied", entity: "user", entityId: caller.uid, detail: "Sign in refused: not invited" },
      );
      throw fail.precondition("You haven't been given access. Ask a manager to invite you.");
    }
    await auditNow({ uid: caller.uid, email: caller.email, channel }, { action: "create", entity: "user", entityId: caller.uid, detail: "First sign in" });
  }
  if (!user.active) throw fail.precondition("Your account has been deactivated.");

  const last = user.lastSeenAt?.toMillis() ?? 0;
  if (Date.now() - last > 10 * 60 * 1000) {
    ref.update({ lastSeenAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  }

  const permissions = await permissionsFor(user.roleIds);
  return {
    uid: caller.uid,
    email: user.email,
    channel,
    user,
    permissions,
    org,
    can: (p) => permissions.has(p),
    touched: new Set(),
  };
}

/** A context for scheduled jobs and triggers. */
export async function systemCtx(): Promise<Ctx> {
  const permissions = new Set(ALL_PERMISSIONS);
  return {
    uid: "system",
    channel: "system",
    user: { email: "system", displayName: "System", roleIds: [], active: true, invited: false, createdAt: Timestamp.now() },
    permissions,
    org: await getOrgSettings(),
    can: () => true,
    touched: new Set(),
  };
}
