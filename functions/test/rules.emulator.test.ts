import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import { ref, getBytes, uploadString } from "firebase/storage";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-ccm",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
    storage: { rules: readFileSync(new URL("../../storage.rules", import.meta.url), "utf8") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

describe("security rules", () => {
  it("deny all direct Firestore access, even to signed in super users", async () => {
    const db = env.authenticatedContext("boss", { email: "boss@example.org", firebase: { sign_in_provider: "google.com" } }).firestore();
    await assertFails(getDoc(doc(db, "clients/any")));
    await assertFails(getDocs(collection(db, "clients")));
    await assertFails(getDoc(doc(db, "audit/any")));
    await assertFails(setDoc(doc(db, "audit/any"), { forged: true }));
    await assertFails(setDoc(doc(db, "users/boss"), { roleIds: ["super-user"] }));
  });

  it("deny direct Storage access", async () => {
    const storage = env.authenticatedContext("boss").storage("gs://demo-ccm.appspot.com");
    await assertFails(getBytes(ref(storage, "clients/c1/f1")));
    await assertFails(uploadString(ref(storage, "clients/c1/f2"), "hello"));
  });
});
