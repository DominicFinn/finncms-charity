import type { AnswerValue, Question, QuestionSet } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import { auditInBatch } from "../core/audit.js";
import type { Ctx } from "../core/context.js";
import type { HandlerGroup } from "../core/dispatch.js";
import { fail } from "../core/errors.js";
import { C, db, docOut, serialise } from "../core/firebase.js";
import { clientFor, omitId, strip, touchActivity } from "./common.js";

export async function loadSet(setId: string): Promise<QuestionSet> {
  const snap = await db.collection(C.questionSets).doc(setId).get();
  if (!snap.exists) throw fail.notFound("Question set");
  return docOut<QuestionSet>(snap);
}

export async function loadQuestions(ids: string[]): Promise<Map<string, Question>> {
  const out = new Map<string, Question>();
  if (ids.length === 0) return out;
  const snaps = await db.getAll(...ids.map((id) => db.collection(C.questions).doc(id)));
  for (const s of snaps) if (s.exists) out.set(s.id, docOut<Question>(s));
  return out;
}

export function assertCanSeeSet(ctx: Ctx, set: QuestionSet) {
  if (set.sensitive && !ctx.can("questionnaires.viewSensitive")) {
    throw fail.denied("This question set is sensitive. You don't have permission to see it.");
  }
}

/** Checks answers against the questions in a set. Returns the cleaned answers. */
export function validateAnswers(
  set: QuestionSet,
  questions: Map<string, Question>,
  answers: Record<string, AnswerValue>,
): Record<string, AnswerValue> {
  const errors: { path: string; message: string }[] = [];
  const out: Record<string, AnswerValue> = {};
  for (const [qid, value] of Object.entries(answers)) {
    if (!set.questionIds.includes(qid)) {
      errors.push({ path: qid, message: "Question is not part of this set" });
      continue;
    }
    const q = questions.get(qid);
    if (!q) continue;
    if (value === null || value === "") {
      out[qid] = null;
      continue;
    }
    const bad = (message: string) => errors.push({ path: qid, message });
    switch (q.type) {
      case "text":
        if (typeof value !== "string") bad("Expected text");
        break;
      case "yes_no":
        if (typeof value !== "boolean") bad("Expected yes or no");
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) bad("Expected a number");
        break;
      case "date":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad("Expected a date (YYYY-MM-DD)");
        break;
      case "scale": {
        const s = q.scale ?? { min: 1, max: 5 };
        if (typeof value !== "number" || !Number.isInteger(value) || value < s.min || value > s.max) {
          bad(`Expected a whole number from ${s.min} to ${s.max}`);
        }
        break;
      }
      case "single_choice":
        if (typeof value !== "string" || !(q.options ?? []).includes(value)) bad("Not one of the options");
        break;
      case "multiple_choice":
        if (!Array.isArray(value) || value.some((v) => !(q.options ?? []).includes(v))) bad("Not one of the options");
        break;
    }
    out[qid] = value;
  }
  if (errors.length) throw fail.invalid("Some answers are not valid.", errors);
  return out;
}

export const questionnaireHandlers: HandlerGroup = {
  async "questions.list"(input) {
    const snap = await db.collection(C.questions).orderBy("text").get();
    return snap.docs.map((d) => docOut<Question>(d)).filter((q) => input.includeArchived || !q.archived);
  },

  async "questions.upsert"(input, ctx) {
    if ((input.type === "single_choice" || input.type === "multiple_choice") && !(input.options?.length)) {
      throw fail.invalid("Choice questions need at least one option.");
    }
    if (input.type === "scale" && (!input.scale || input.scale.min >= input.scale.max)) {
      throw fail.invalid("A scale needs a minimum lower than its maximum.");
    }
    const ref = input.id ? db.collection(C.questions).doc(input.id) : db.collection(C.questions).doc();
    const before = input.id ? (await ref.get()).data() : undefined;
    if (input.id && !before) throw fail.notFound("Question");
    const data = strip(omitId(input));
    const batch = db.batch();
    batch.set(ref, data);
    await auditInBatch(batch, ctx, {
      action: before ? "update" : "create",
      entity: "question",
      entityId: ref.id,
      op: "questions.upsert",
      before: before ? serialise(before) : undefined,
      after: data,
    });
    await batch.commit();
    return { ...data, id: ref.id } as Question;
  },

  async "questionSets.list"(input) {
    const snap = await db.collection(C.questionSets).orderBy("name").get();
    return snap.docs
      .map((d) => docOut<QuestionSet>(d))
      .filter((s) => (input.includeArchived || !s.archived) && (!input.kind || s.kind === input.kind));
  },

  async "questionSets.upsert"(input, ctx) {
    const questions = await loadQuestions(input.questionIds);
    const missing = input.questionIds.filter((id) => !questions.has(id));
    if (missing.length) throw fail.invalid(`Unknown questions: ${missing.join(", ")}`);
    if (input.kind === "outcome" && input.attachByDefault) throw fail.invalid("Outcome measures can't be attached to clients.");
    const ref = input.id ? db.collection(C.questionSets).doc(input.id) : db.collection(C.questionSets).doc();
    const before = input.id ? (await ref.get()).data() : undefined;
    if (input.id && !before) throw fail.notFound("Question set");
    if (before && before.kind !== input.kind) throw fail.invalid("A question set's kind can't be changed.");
    const data = strip(omitId(input));
    const batch = db.batch();
    batch.set(ref, data);
    await auditInBatch(batch, ctx, {
      action: before ? "update" : "create",
      entity: "questionSet",
      entityId: ref.id,
      op: "questionSets.upsert",
      before: before ? serialise(before) : undefined,
      after: data,
    });
    await batch.commit();
    return { ...data, id: ref.id } as QuestionSet;
  },

  async "answers.get"(input, ctx) {
    const set = await loadSet(input.setId);
    assertCanSeeSet(ctx, set);
    await clientFor(ctx, input.clientId, "read");
    let q = db
      .collection(C.answers)
      .where("clientId", "==", input.clientId)
      .where("setId", "==", input.setId)
      .orderBy("version", "desc");
    if (!input.includeHistory) q = q.limit(1);
    const snap = await q.get();
    const all = snap.docs.map((d) => docOut<import("@ccm/shared").AnswerSet>(d));
    return { current: all[0] ?? null, history: input.includeHistory ? all.slice(1) : [] };
  },

  async "answers.save"(input, ctx) {
    const set = await loadSet(input.setId);
    if (set.kind !== "questionnaire") throw fail.invalid("Use outcomes.record for outcome measures.");
    assertCanSeeSet(ctx, set);
    const { client } = await clientFor(ctx, input.clientId, set.sensitive ? "sensitive" : "activity");
    if (!client.questionSetIds?.includes(input.setId)) throw fail.precondition("This questionnaire isn't attached to the client.");
    const questions = await loadQuestions(set.questionIds);
    const answers = validateAnswers(set, questions, input.answers);

    const latest = await db
      .collection(C.answers)
      .where("clientId", "==", input.clientId)
      .where("setId", "==", input.setId)
      .orderBy("version", "desc")
      .limit(1)
      .get();
    const previous = latest.docs[0];
    const version = previous ? (previous.get("version") as number) + 1 : 1;
    // Deterministic id means two people saving at once can't both create the same version.
    const ref = db.collection(C.answers).doc(`${input.clientId}_${input.setId}_v${version}`);
    const data = { clientId: input.clientId, setId: input.setId, version, answers, recordedBy: ctx.uid, recordedAt: Timestamp.now() };
    const batch = db.batch();
    batch.create(ref, data);
    touchActivity(batch, input.clientId);
    await auditInBatch(batch, ctx, {
      action: "create",
      entity: "answers",
      entityId: ref.id,
      clientIds: [input.clientId],
      op: "answers.save",
      before: previous ? { version: previous.get("version"), answers: previous.get("answers") } : undefined,
      after: { version, answers },
    });
    try {
      await batch.commit();
    } catch (err) {
      if ((err as { code?: number }).code === 6) throw fail.exists("Someone else saved these answers at the same time. Reload and try again.");
      throw err;
    }
    return serialise({ id: ref.id, ...data });
  },
};
