import {
  ALL_PERMISSIONS,
  SUPER_USER_ROLE_ID,
  type ApiTokenSummary,
  type HelpCategory,
  type OtherLocationUsage,
  type SessionLocation,
  type OrgSettings,
  type Role,
  type SessionType,
  type UserRecord,
} from "@ccm/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auditInBatch, auditNow, changedFields } from "../core/audit.js";
import { getOrgSettings, type UserDoc } from "../core/context.js";
import { randomToken, sha256 } from "../core/crypto.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db, docOut, serialise, toIso } from "../core/firebase.js";
import { omitId, strip } from "./common.js";
import { disconnectCalendar } from "../calendar.js";

export function userOut(uid: string, d: UserDoc): UserRecord {
  return serialise<UserRecord>({
    uid,
    email: d.email,
    displayName: d.displayName,
    photoURL: d.photoURL,
    roleIds: d.roleIds ?? [],
    active: d.active,
    invited: d.invited ?? false,
    calendarConnected: d.calendarConnected ?? false,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
  });
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "item"
  );
}

/** Generic upsert for small managed lists. */
async function upsertListItem<T extends { id?: string; name: string }>(
  collection: string,
  entity: string,
  op: string,
  input: T,
  actor: Parameters<typeof auditNow>[0],
) {
  const ref = input.id ? db.collection(collection).doc(input.id) : db.collection(collection).doc(slug(input.name));
  const existing = await ref.get();
  if (input.id && !existing.exists) throw fail.notFound(entity);
  if (!input.id && existing.exists) throw fail.exists(`A ${entity.toLowerCase()} called "${input.name}" already exists.`);
  const data = strip(omitId(input));
  const batch = db.batch();
  batch.set(ref, data);
  await auditInBatch(batch, actor, {
    action: existing.exists ? "update" : "create",
    entity,
    entityId: ref.id,
    op,
    before: existing.exists ? serialise(existing.data()) : undefined,
    after: data,
  });
  await batch.commit();
  return { ...data, id: ref.id };
}

async function activeSuperUserCount(): Promise<number> {
  const q = await db.collection(C.users).where("roleIds", "array-contains", SUPER_USER_ROLE_ID).where("active", "==", true).get();
  return q.docs.filter((d) => d.get("invited") !== true).length;
}

function tokenOut(id: string, d: FirebaseFirestore.DocumentData): ApiTokenSummary {
  return serialise<ApiTokenSummary>({
    id,
    name: d.name,
    createdAt: d.createdAt,
    lastUsedAt: d.lastUsedAt,
    expiresAt: d.expiresAt,
    revokedAt: d.revokedAt,
  });
}

export const TOKEN_PREFIX = "ccm_";

async function otherLocationIds(): Promise<string[]> {
  const q = await db.collection(C.sessionLocations).where("isOther", "==", true).get();
  return q.docs.map((d) => d.id).slice(0, 30);
}

export const adminHandlers: HandlerGroup = {
  async "helpCategories.list"(input) {
    const snap = await db.collection(C.helpCategories).orderBy("name").get();
    return snap.docs.map((d) => docOut<HelpCategory>(d)).filter((c) => input.includeArchived || !c.archived);
  },
  async "helpCategories.upsert"(input, ctx) {
    return (await upsertListItem(C.helpCategories, "Help category", "helpCategories.upsert", input, ctx)) as HelpCategory;
  },
  async "sessionTypes.list"(input) {
    const snap = await db.collection(C.sessionTypes).orderBy("name").get();
    return snap.docs.map((d) => docOut<SessionType>(d)).filter((c) => input.includeArchived || !c.archived);
  },
  async "sessionTypes.upsert"(input, ctx) {
    return (await upsertListItem(C.sessionTypes, "Session type", "sessionTypes.upsert", input, ctx)) as SessionType;
  },

  async "sessionLocations.list"(input) {
    const snap = await db.collection(C.sessionLocations).orderBy("name").get();
    return snap.docs.map((d) => docOut<SessionLocation>(d)).filter((c) => input.includeArchived || !c.archived);
  },
  async "sessionLocations.upsert"(input, ctx) {
    return (await upsertListItem(C.sessionLocations, "Session location", "sessionLocations.upsert", input, ctx)) as SessionLocation;
  },

  async "sessionLocations.otherValues"() {
    const others = await otherLocationIds();
    if (others.length === 0) return [];
    const snap = await db.collection(C.sessions).where("locationId", "in", others).get();
    const usage = new Map<string, OtherLocationUsage>();
    for (const d of snap.docs) {
      const text = (d.get("locationOther") as string | undefined)?.trim();
      if (!text) continue;
      const key = text.toLowerCase();
      const at = toIso(d.get("startsAt")) ?? "";
      const row = usage.get(key);
      if (!row) usage.set(key, { text, sessions: 1, lastUsedAt: at });
      else {
        row.sessions += 1;
        // Show the spelling used most recently.
        if (at > row.lastUsedAt) {
          row.lastUsedAt = at;
          row.text = text;
        }
      }
    }
    return [...usage.values()].sort((a, b) => b.sessions - a.sessions || a.text.localeCompare(b.text));
  },

  async "sessionLocations.promoteOther"(input, ctx) {
    const target = await db.collection(C.sessionLocations).doc(input.locationId).get();
    if (!target.exists || target.get("archived")) throw fail.invalid("Unknown session location.");
    if (target.get("isOther")) throw fail.invalid("Choose a location other than Other.");
    const others = await otherLocationIds();
    if (others.length === 0) return { moved: 0 };
    const wanted = new Set(input.texts.map((t) => t.trim().toLowerCase()));
    const snap = await db.collection(C.sessions).where("locationId", "in", others).get();
    const matches = snap.docs.filter((d) => wanted.has(String(d.get("locationOther") ?? "").trim().toLowerCase()));
    // Batches of 200 sessions, each with its audit entry.
    for (let i = 0; i < matches.length; i += 200) {
      const batch = db.batch();
      for (const d of matches.slice(i, i + 200)) {
        batch.update(d.ref, { locationId: input.locationId, locationOther: FieldValue.delete(), "dims.locationId": input.locationId });
      }
      await auditInBatch(batch, ctx, {
        action: "update",
        entity: "session",
        op: "sessionLocations.promoteOther",
        clientIds: [...new Set(matches.slice(i, i + 200).map((d) => d.get("clientId") as string))],
        detail: `${Math.min(200, matches.length - i)} sessions moved from Other to ${target.get("name")}`,
      });
      await batch.commit();
    }
    // Outcomes linked to those sessions carry the location for reports too.
    const sessionIds = matches.map((d) => d.id);
    for (let i = 0; i < sessionIds.length; i += 30) {
      const outcomes = await db.collection(C.outcomes).where("sessionId", "in", sessionIds.slice(i, i + 30)).get();
      if (outcomes.empty) continue;
      const batch = db.batch();
      outcomes.docs.forEach((o) => batch.update(o.ref, { "dims.locationId": input.locationId }));
      await batch.commit();
    }
    return { moved: matches.length };
  },

  async "org.updateSettings"(input, ctx) {
    const before = await getOrgSettings();
    if (input.retentionMonths !== undefined && input.retentionMonths < before.retentionMonths && !ctx.can("clients.anonymise")) {
      throw fail.denied("Shortening the retention period needs permission to anonymise clients.");
    }
    if (
      input.referralRetentionDays !== undefined &&
      input.referralRetentionDays < before.referralRetentionDays &&
      !ctx.can("clients.anonymise")
    ) {
      throw fail.denied("Shortening how long referrals are kept needs permission to anonymise clients.");
    }
    const after: OrgSettings = { ...before, ...input };
    if (input.allowedDomains) after.allowedDomains = [...new Set(input.allowedDomains.filter(Boolean))];
    const batch = db.batch();
    batch.set(db.collection(C.config).doc("org"), after);
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "orgSettings",
      entityId: "org",
      op: "org.updateSettings",
      ...changedFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>),
    });
    await batch.commit();
    return after;
  },

  async "users.list"(input) {
    const snap = await db.collection(C.users).orderBy("displayName").get();
    return snap.docs.map((d) => userOut(d.id, d.data() as UserDoc)).filter((u) => input.includeInactive || u.active);
  },

  async "users.invite"(input, ctx) {
    const email = input.email.toLowerCase();
    const existing = await db.collection(C.users).where("email", "==", email).limit(1).get();
    if (!existing.empty) throw fail.exists("That person already has an account or an invitation.");
    await assertRolesExist(input.roleIds);
    // Invitations live in the users collection under a placeholder id until
    // the person first signs in, when the record moves to their real uid.
    const ref = db.collection(C.users).doc(`invite-${sha256(email).slice(0, 24)}`);
    const data: UserDoc = {
      email,
      displayName: input.displayName || email,
      roleIds: input.roleIds,
      active: true,
      invited: true,
      calendarConnected: false,
      createdAt: Timestamp.now(),
    };
    const batch = db.batch();
    batch.create(ref, data);
    await auditInBatch(batch, ctx, { action: "create", entity: "user", entityId: ref.id, op: "users.invite", after: { email, roleIds: input.roleIds } });
    await batch.commit();
    return userOut(ref.id, data);
  },

  async "users.update"(input, ctx) {
    const ref = db.collection(C.users).doc(input.uid);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("User");
    const before = snap.data() as UserDoc;
    const patch: Partial<Pick<UserDoc, "roleIds" | "active" | "displayName">> = strip({
      roleIds: input.roleIds,
      active: input.active,
      displayName: input.displayName,
    });
    if (patch.roleIds) await assertRolesExist(patch.roleIds);
    const after: UserDoc = { ...before, ...patch };

    const wasSuper = before.active && before.roleIds.includes(SUPER_USER_ROLE_ID) && !before.invited;
    const isSuper = after.active && after.roleIds.includes(SUPER_USER_ROLE_ID);
    if (wasSuper && !isSuper && (await activeSuperUserCount()) <= 1) {
      throw fail.precondition("There must always be at least one active super user.");
    }
    if (input.uid === ctx.uid && input.active === false) throw fail.precondition("You can't deactivate yourself.");

    const batch = db.batch();
    batch.update(ref, patch);
    await auditInBatch(batch, ctx, {
      action: "update",
      entity: "user",
      entityId: input.uid,
      op: "users.update",
      ...changedFields(
        { roleIds: before.roleIds, active: before.active, displayName: before.displayName },
        { roleIds: after.roleIds, active: after.active, displayName: after.displayName },
      ),
    });
    await batch.commit();

    // Deactivation also revokes the user's MCP tokens and calendar access.
    if (input.active === false) {
      const tokens = await db.collection(C.apiTokens).where("uid", "==", input.uid).get();
      await Promise.all(tokens.docs.filter((t) => !t.get("revokedAt")).map((t) => t.ref.update({ revokedAt: Timestamp.now() })));
      await disconnectCalendar(input.uid);
    }
    return userOut(input.uid, after);
  },

  async "roles.list"() {
    const snap = await db.collection(C.roles).orderBy("name").get();
    return snap.docs.map((d) => {
      const r = docOut<Role>(d);
      r.system = d.id === SUPER_USER_ROLE_ID;
      if (r.system) r.permissions = [...ALL_PERMISSIONS];
      return r;
    });
  },

  async "roles.upsert"(input, ctx) {
    if (input.id === SUPER_USER_ROLE_ID) throw fail.precondition("The super user role always has every permission and can't be edited.");
    const ref = input.id ? db.collection(C.roles).doc(input.id) : db.collection(C.roles).doc(slug(input.name));
    const existing = await ref.get();
    if (input.id && !existing.exists) throw fail.notFound("Role");
    if (!input.id && existing.exists) throw fail.exists(`A role called "${input.name}" already exists.`);
    const data = strip({ name: input.name, description: input.description, permissions: [...new Set(input.permissions)], system: false });
    const batch = db.batch();
    batch.set(ref, data);
    await auditInBatch(batch, ctx, {
      action: existing.exists ? "update" : "create",
      entity: "role",
      entityId: ref.id,
      op: "roles.upsert",
      before: existing.exists ? serialise(existing.data()) : undefined,
      after: data,
    });
    await batch.commit();
    return { id: ref.id, ...data } as Role;
  },

  async "roles.delete"(input, ctx) {
    if (input.id === SUPER_USER_ROLE_ID) throw fail.precondition("The super user role can't be deleted.");
    const ref = db.collection(C.roles).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound("Role");
    const holders = await db.collection(C.users).where("roleIds", "array-contains", input.id).limit(1).get();
    if (!holders.empty) throw fail.precondition("Remove this role from everyone who has it before deleting it.");
    const batch = db.batch();
    batch.delete(ref);
    await auditInBatch(batch, ctx, { action: "delete", entity: "role", entityId: input.id, op: "roles.delete", before: serialise(snap.data()) });
    await batch.commit();
    return { ok: true };
  },

  async "tokens.list"(_input, ctx) {
    const snap = await db.collection(C.apiTokens).where("uid", "==", ctx.uid).get();
    return snap.docs
      .map((d) => tokenOut(d.id, d.data()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async "tokens.create"(input, ctx) {
    const secret = `${TOKEN_PREFIX}${randomToken(32)}`;
    const ref = db.collection(C.apiTokens).doc(sha256(secret));
    const now = Timestamp.now();
    const data = {
      uid: ctx.uid,
      name: input.name,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + input.expiresInDays * 86_400_000),
    };
    const batch = db.batch();
    batch.create(ref, data);
    await auditInBatch(batch, ctx, { action: "token_created", entity: "apiToken", entityId: ref.id.slice(0, 12), op: "tokens.create", detail: input.name });
    await batch.commit();
    return { token: secret, summary: tokenOut(ref.id, data) };
  },

  async "tokens.revoke"(input, ctx) {
    const ref = db.collection(C.apiTokens).doc(input.id);
    const snap = await ref.get();
    if (!snap.exists || snap.get("uid") !== ctx.uid) throw fail.notFound("Token");
    const batch = db.batch();
    batch.update(ref, { revokedAt: Timestamp.now() });
    await auditInBatch(batch, ctx, { action: "token_revoked", entity: "apiToken", entityId: input.id.slice(0, 12), op: "tokens.revoke" });
    await batch.commit();
    return { ok: true };
  },
};

async function assertRolesExist(roleIds: string[]) {
  if (roleIds.length === 0) return;
  const snaps = await db.getAll(...roleIds.map((id) => db.collection(C.roles).doc(id)));
  const missing = snaps.filter((s) => !s.exists && s.id !== SUPER_USER_ROLE_ID).map((s) => s.id);
  if (missing.length) throw fail.invalid(`Unknown roles: ${missing.join(", ")}`);
}
