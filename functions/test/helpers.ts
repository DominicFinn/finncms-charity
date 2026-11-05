import { DEFAULT_ROLES, type OpInput, type OpName, type OpOutput } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import { resolveCaller, type Ctx } from "../src/core/context.js";
import { dispatch, registerHandlers } from "../src/core/dispatch.js";
import { C, db } from "../src/core/firebase.js";
import { handlers } from "../src/handlers/index.js";

registerHandlers(handlers);

export async function clearFirestore() {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-ccm/databases/(default)/documents`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to clear Firestore: ${res.status}`);
}

export async function seedBasics() {
  const batch = db.batch();
  for (const r of DEFAULT_ROLES) {
    batch.set(db.collection(C.roles).doc(r.id), { name: r.name, description: r.description, permissions: r.permissions, system: !!r.system });
  }
  for (const [id, name] of [
    ["lifts", "Lifts to appointments"],
    ["health", "Health"],
    ["loneliness", "Loneliness and social contact"],
  ]) {
    batch.set(db.collection(C.helpCategories).doc(id), { name, archived: false });
  }
  batch.set(db.collection(C.sessionTypes).doc("in-person"), { name: "In person", inPerson: true, archived: false });
  batch.set(db.collection(C.sessionLocations).doc("clients-home"), { name: "Client's home", isOther: false, archived: false });
  batch.set(db.collection(C.sessionLocations).doc("hospital"), { name: "Hospital", isOther: false, archived: false });
  batch.set(db.collection(C.sessionLocations).doc("other"), { name: "Other", isOther: true, archived: false });
  batch.set(db.collection(C.sessionTypes).doc("phone"), { name: "Phone call", inPerson: false, archived: false });
  batch.set(db.collection(C.questions).doc("q-lonely"), { text: "Do you often feel lonely?", type: "yes_no", archived: false });
  batch.set(db.collection(C.questions).doc("q-illness"), { text: "What illnesses do you have?", type: "text", archived: false });
  batch.set(db.collection(C.questions).doc("q-helped"), { text: "Has this service helped you?", type: "yes_no", archived: false });
  batch.set(db.collection(C.questions).doc("q-better"), {
    text: "How much has your situation improved?",
    type: "scale",
    scale: { min: 1, max: 5 },
    archived: false,
  });
  batch.set(db.collection(C.questions).doc("q-comment"), { text: "Anything else?", type: "text", archived: false });
  batch.set(db.collection(C.questionSets).doc("social"), {
    name: "Social contact",
    kind: "questionnaire",
    sensitive: false,
    questionIds: ["q-lonely"],
    attachByDefault: true,
    archived: false,
  });
  batch.set(db.collection(C.questionSets).doc("health"), {
    name: "Health",
    kind: "questionnaire",
    sensitive: true,
    questionIds: ["q-illness"],
    attachByDefault: true,
    archived: false,
  });
  batch.set(db.collection(C.questionSets).doc("impact"), {
    name: "Impact",
    kind: "outcome",
    sensitive: false,
    questionIds: ["q-helped", "q-better", "q-comment"],
    attachByDefault: false,
    archived: false,
  });
  await batch.commit();
}

let n = 0;
/** Creates an active user with the given roles and returns their context. */
export async function userWith(roleIds: string[], name = `User ${++n}`): Promise<Ctx> {
  const uid = `uid-${name.toLowerCase().replace(/\W+/g, "-")}-${n++}`;
  const email = `${uid}@example.org`;
  await db.collection(C.users).doc(uid).set({
    email,
    displayName: name,
    roleIds,
    active: true,
    invited: false,
    createdAt: Timestamp.now(),
  });
  return resolveCaller({ uid, email, provider: "google.com", emailVerified: true }, "ui");
}

export function call<N extends OpName>(ctx: Ctx, op: N, input: OpInput<N>): Promise<OpOutput<N>> {
  return dispatch(op, input, { ...ctx, touched: new Set() });
}

export async function auditFor(filter: { op?: string; actorUid?: string; clientId?: string }) {
  let q: FirebaseFirestore.Query = db.collection(C.audit);
  if (filter.op) q = q.where("op", "==", filter.op);
  if (filter.actorUid) q = q.where("actorUid", "==", filter.actorUid);
  if (filter.clientId) q = q.where("clientIds", "array-contains", filter.clientId);
  const snap = await q.get();
  return snap.docs.map((d) => d.data());
}

export const NEW_CLIENT = {
  firstName: "Mary",
  lastName: "O'Brien",
  preferredName: "Molly",
  dateOfBirth: "1941-03-17",
  addressLines: ["12 Shamrock Road"],
  town: "Nottingham",
  postcode: "ng7 2rd",
  phones: [{ label: "Home", number: "0115 000 0000" }],
  preferredContactMethod: "phone" as const,
  contacts: [{ name: "Sean O'Brien", relationship: "Son", phone: "07700 900000", isNextOfKin: true }],
  helpCategoryIds: ["lifts", "loneliness"],
};
