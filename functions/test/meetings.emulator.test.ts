import { SUPER_USER_ROLE_ID } from "@ccm/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { C, db } from "../src/core/firebase.js";
import { auditFor, call, clearFirestore, seedBasics, userWith } from "./helpers.js";

beforeEach(async () => {
  await clearFirestore();
  await seedBasics();
});

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const at = (offsetDays: number, hour = 18) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function board(manager: Awaited<ReturnType<typeof userWith>>) {
  const names = [
    ["Áine Byrne", "Chair"],
    ["Patrick Kelly", "Treasurer"],
    ["Siobhán Walsh", "Secretary"],
    ["Declan Murphy", "Trustee"],
  ];
  const out = [];
  for (const [name, role] of names) out.push(await call(manager, "trustees.upsert", { name, role, startDate: day(-400) }));
  return out;
}

describe("trustees", () => {
  it("needs the meetings permissions", async () => {
    const vol = await userWith(["volunteer"], "Vol");
    const caseworker = await userWith(["caseworker"], "Case");
    await expectCode(call(vol, "trustees.list", {}), "permission-denied");
    await expectCode(call(caseworker, "meetings.list", {}), "permission-denied");
    const manager = await userWith(["manager"], "Manager");
    expect(manager.can("meetings.manage")).toBe(true);
    expect(await call(manager, "trustees.list", {})).toEqual([]);
  });

  it("adds, updates and stands down trustees, keeping former ones on request", async () => {
    const manager = await userWith(["manager"], "Manager");
    const t = await call(manager, "trustees.upsert", { name: "Áine Byrne", role: "Chair", email: "aine@example.org", startDate: "2024-01-01", userUid: manager.uid });
    expect(t).toMatchObject({ name: "Áine Byrne", role: "Chair", active: true, userUid: manager.uid });

    const updated = await call(manager, "trustees.upsert", { id: t.id, name: "Áine Byrne", role: "Trustee", email: "", endDate: day(-1), active: false });
    expect(updated.role).toBe("Trustee");
    expect(updated.email).toBeUndefined();
    expect(updated.userUid).toBeUndefined();

    expect(await call(manager, "trustees.list", {})).toEqual([]);
    expect((await call(manager, "trustees.list", { includeInactive: true })).map((x) => x.id)).toEqual([t.id]);

    await expectCode(call(manager, "trustees.upsert", { name: "X", role: "Trustee", startDate: "2026-02-01", endDate: "2026-01-01" }), "invalid-argument");
    await expectCode(call(manager, "trustees.upsert", { name: "X", role: "Trustee", userUid: "nobody" }), "invalid-argument");

    const audit = await auditFor({ op: "trustees.upsert" });
    expect(audit.map((a) => a.action).sort()).toEqual(["create", "update"]);
  });
});

describe("meetings", () => {
  it("schedules a meeting, records the register and works out quorum", async () => {
    const manager = await userWith(["manager"], "Manager");
    const [a, b, c, d] = await board(manager);
    const m = await call(manager, "meetings.create", {
      title: "Board meeting",
      type: "board",
      startsAt: at(-7),
      location: "Irish Centre",
      agenda: [{ title: "Apologies" }, { title: "Finance report", presenter: "Patrick Kelly" }],
    });
    expect(m.status).toBe("draft");
    expect(m.agenda.map((i) => i.id).every(Boolean)).toBe(true);

    await call(manager, "meetings.setRegister", {
      id: m.id,
      attendance: [
        { trusteeId: a.id, status: "present" },
        { trusteeId: b.id, status: "present" },
        { trusteeId: c.id, status: "apologies" },
        { trusteeId: d.id, status: "absent" },
      ],
      guests: [{ name: "Mary Doyle", organisation: "Community Foundation" }],
      staffUids: [manager.uid],
    });
    let detail = await call(manager, "meetings.get", { id: m.id });
    expect(detail.quorum).toEqual({ eligible: 4, present: 2, required: 3, quorate: false });
    expect(detail.trustees).toHaveLength(4);
    expect(detail.meeting.guests).toEqual([{ name: "Mary Doyle", organisation: "Community Foundation" }]);

    // A lower minimum makes it quorate. Settings are read when the caller signs in.
    await call(manager, "org.updateSettings", { quorumMinimum: 2 });
    const fresh = await userWith(["manager"], "Manager two");
    detail = await call(fresh, "meetings.get", { id: m.id });
    expect(detail.quorum.quorate).toBe(true);

    await expectCode(call(manager, "meetings.setRegister", { id: m.id, attendance: [{ trusteeId: "ghost", status: "present" }] }), "invalid-argument");
    await expectCode(call(manager, "meetings.create", { title: "Bad", type: "board", startsAt: at(1, 18), endsAt: at(1, 17) }), "invalid-argument");

    const reads = await auditFor({ op: "meetings.get" });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0].action).toBe("read");
  });

  it("writes minutes, then locks them once approved at a later meeting", async () => {
    const manager = await userWith(["manager"], "Manager");
    const first = await call(manager, "meetings.create", { title: "March board", type: "board", startsAt: at(-30), agenda: [{ title: "Finance" }] });
    const second = await call(manager, "meetings.create", { title: "April board", type: "board", startsAt: at(-2) });

    const item = first.agenda[0];
    const withMinutes = await call(manager, "meetings.update", {
      id: first.id,
      patch: { agenda: [{ ...item, minutes: "Accounts accepted." }], generalMinutes: "Meeting opened at 6pm." },
    });
    expect(withMinutes.agenda[0]).toMatchObject({ id: item.id, minutes: "Accounts accepted." });

    await expectCode(call(manager, "meetings.approveMinutes", { id: second.id, atMeetingId: first.id }), "invalid-argument");
    await expectCode(call(manager, "meetings.approveMinutes", { id: first.id, atMeetingId: first.id }), "invalid-argument");

    const approved = await call(manager, "meetings.approveMinutes", { id: first.id, atMeetingId: second.id });
    expect(approved).toMatchObject({ status: "approved", approvedBy: manager.uid, approvedAtMeetingId: second.id });
    expect((await call(manager, "meetings.get", { id: first.id })).approvedAtMeeting?.title).toBe("April board");

    await expectCode(call(manager, "meetings.update", { id: first.id, patch: { generalMinutes: "Changed" } }), "failed-precondition");
    await expectCode(call(manager, "meetings.setRegister", { id: first.id, attendance: [] }), "failed-precondition");
    await expectCode(call(manager, "meetingActions.create", { meetingId: first.id, description: "Late action" }), "failed-precondition");

    const reopened = await call(manager, "meetings.reopenMinutes", { id: first.id, reason: "Typo in the finance item" });
    expect(reopened.status).toBe("draft");
    expect(reopened.approvedAt).toBeUndefined();
    const audit = await auditFor({ op: "meetings.reopenMinutes" });
    expect(audit[0].diff.after.reason).toBe("Typo in the finance item");
  });

  it("only lets managers change meetings", async () => {
    const manager = await userWith(["manager"], "Manager");
    await db.collection(C.roles).doc("trustee-viewer").set({ name: "Viewer", permissions: ["meetings.view"] });
    const viewer = await userWith(["trustee-viewer"], "Viewer");
    const m = await call(manager, "meetings.create", { title: "AGM", type: "agm", startsAt: at(10) });
    expect((await call(viewer, "meetings.get", { id: m.id })).meeting.title).toBe("AGM");
    await expectCode(call(viewer, "meetings.update", { id: m.id, patch: { title: "Changed" } }), "permission-denied");
    await expectCode(call(viewer, "meetingActions.create", { meetingId: m.id, description: "x" }), "permission-denied");
    const denied = await auditFor({ actorUid: viewer.uid });
    expect(denied.some((e) => e.action === "denied")).toBe(true);
  });
});

describe("meeting actions", () => {
  it("carries open actions forward until they are done at a later meeting", async () => {
    const manager = await userWith(["manager"], "Manager");
    const other = await userWith([SUPER_USER_ROLE_ID], "Other");
    const [chair] = await board(manager);
    await call(manager, "trustees.upsert", { id: chair.id, name: chair.name, role: chair.role, startDate: chair.startDate, userUid: manager.uid });

    const march = await call(manager, "meetings.create", { title: "March", type: "board", startsAt: at(-30) });
    const april = await call(manager, "meetings.create", { title: "April", type: "board", startsAt: at(-2) });
    const may = await call(manager, "meetings.create", { title: "May", type: "board", startsAt: at(28) });

    const overdue = await call(manager, "meetingActions.create", { meetingId: march.id, description: "Renew insurance", ownerTrusteeId: chair.id, dueDate: day(-5) });
    const later = await call(manager, "meetingActions.create", { meetingId: march.id, description: "Book AGM venue", ownerUid: other.uid, dueDate: day(20) });
    const aprilAction = await call(manager, "meetingActions.create", { meetingId: april.id, description: "Draft annual report" });
    expect(overdue.raisedAt).toBe(march.startsAt);

    let aprilDetail = await call(manager, "meetings.get", { id: april.id });
    expect(aprilDetail.carriedForward.map((a) => a.id)).toEqual([overdue.id, later.id]);
    expect(aprilDetail.actions.map((a) => a.id)).toEqual([aprilAction.id]);
    expect((await call(manager, "meetings.get", { id: march.id })).carriedForward).toEqual([]);

    expect((await call(manager, "meetingActions.list", { mine: true })).map((a) => a.id)).toEqual([overdue.id]);
    expect((await call(other, "meetingActions.list", { mine: true })).map((a) => a.id)).toEqual([later.id]);
    const overdueList = await call(manager, "meetingActions.list", { overdue: true });
    expect(overdueList.map((a) => a.id)).toEqual([overdue.id]);
    expect(overdueList[0].meetingTitle).toBe("March");
    expect((await call(manager, "dashboard.get", {})).overdueMeetingActions).toBe(1);

    const done = await call(manager, "meetingActions.update", { id: overdue.id, patch: { status: "done" }, atMeetingId: april.id });
    expect(done).toMatchObject({ status: "done", completedAtMeetingId: april.id });
    expect(done.completedAt).toBeTruthy();

    aprilDetail = await call(manager, "meetings.get", { id: april.id });
    expect(aprilDetail.carriedForward.map((a) => a.id)).toEqual([later.id]);
    expect(aprilDetail.completedHere.map((a) => a.id)).toEqual([overdue.id]);
    const mayDetail = await call(manager, "meetings.get", { id: may.id });
    expect(mayDetail.carriedForward.map((a) => a.id).sort()).toEqual([aprilAction.id, later.id].sort());
    expect((await call(manager, "dashboard.get", {})).overdueMeetingActions).toBe(0);

    const reopened = await call(manager, "meetingActions.update", { id: overdue.id, patch: { status: "open" } });
    expect(reopened.completedAt).toBeUndefined();
    expect(reopened.completedAtMeetingId).toBeUndefined();

    // Moving a meeting moves the date its actions were raised.
    await call(manager, "meetings.update", { id: april.id, patch: { startsAt: at(-1) } });
    const moved = await call(manager, "meetingActions.list", { meetingId: april.id });
    expect(moved[0].raisedAt).toBe(at(-1));

    await expectCode(call(manager, "meetingActions.create", { meetingId: may.id, description: "x", ownerTrusteeId: "ghost" }), "invalid-argument");
    await expectCode(call(manager, "meetingActions.update", { id: "missing", patch: { status: "done" } }), "not-found");
  });
});

describe("meeting papers", () => {
  it("uploads a paper and gives a download link to people who can see meetings", async () => {
    const manager = await userWith(["manager"], "Manager");
    const vol = await userWith(["volunteer"], "Vol");
    const m = await call(manager, "meetings.create", { title: "Board", type: "board", startsAt: at(3) });

    await expectCode(
      call(manager, "meetingPapers.createUpload", { meetingId: m.id, fileName: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10, description: "x" }),
      "invalid-argument",
    );

    const body = "Treasurer's report";
    const { paper, uploadUrl, uploadMethod, uploadHeaders } = await call(manager, "meetingPapers.createUpload", {
      meetingId: m.id,
      fileName: "finance.txt",
      contentType: "text/plain",
      sizeBytes: body.length,
      description: "Finance report",
    });
    expect(paper.status).toBe("pending");
    expect((await call(manager, "meetings.get", { id: m.id })).papers).toEqual([]);

    const res = await fetch(uploadUrl, { method: uploadMethod, headers: uploadHeaders, body });
    expect(res.ok).toBe(true);
    const ready = await call(manager, "meetingPapers.completeUpload", { id: paper.id });
    expect(ready.status).toBe("ready");
    expect((await call(manager, "meetings.get", { id: m.id })).papers.map((p) => p.fileName)).toEqual(["finance.txt"]);

    const { url } = await call(manager, "meetingPapers.getDownloadUrl", { id: paper.id });
    expect(await (await fetch(url)).text()).toBe(body);
    await expectCode(call(vol, "meetingPapers.getDownloadUrl", { id: paper.id }), "permission-denied");

    const downloads = await auditFor({ op: "meetingPapers.getDownloadUrl" });
    expect(downloads.map((d) => d.action)).toContain("download");
  });
});
