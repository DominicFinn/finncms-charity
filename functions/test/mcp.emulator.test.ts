import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../src/core/context.js";
import { buildServer } from "../src/mcp.js";
import { auditFor, call, clearFirestore, NEW_CLIENT, seedBasics, userWith } from "./helpers.js";

beforeEach(async () => {
  await clearFirestore();
  await seedBasics();
});

async function connect(ctx: Ctx) {
  const server = buildServer({ ...ctx, channel: "mcp" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP server", () => {
  it("only offers tools the user's role allows", async () => {
    const vol = await connect(await userWith(["volunteer"]));
    const volTools = (await vol.listTools()).tools.map((t) => t.name);
    expect(volTools).toContain("clients_list");
    expect(volTools).not.toContain("clients_create");
    expect(volTools).not.toContain("reports_demand");
    expect(volTools).not.toContain("meetings_get");

    const manager = await connect(await userWith(["manager"]));
    const tools = (await manager.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("reports_demand");
    for (const t of ["meetings_get", "meetingActions_list", "meetingActions_update"]) expect(tools).toContain(t);
    // Never exposed over MCP, whatever the role.
    for (const t of ["clients_anonymise", "clients_export", "users_update", "tokens_create", "meetings_approveMinutes", "meetingPapers_createUpload"]) {
      expect(tools).not.toContain(t);
    }
  });

  it("runs tools as the user and audits with the mcp channel", async () => {
    const cw = await userWith(["caseworker"]);
    const created = await call(cw, "clients.create", NEW_CLIENT);
    const client = await connect(cw);

    const res = await client.callTool({ name: "clients_list", arguments: { search: "molly" } });
    const body = JSON.parse((res.content as { text: string }[])[0].text);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([created.id]);

    const write = await client.callTool({
      name: "notes_create",
      arguments: { clientId: created.id, body: "Called to confirm Tuesday's lift" },
    });
    expect(write.isError).toBeFalsy();

    const audit = await auditFor({ clientId: created.id });
    expect(audit.filter((a) => a.channel === "mcp").map((a) => a.op).sort()).toEqual(["clients.list", "notes.create"]);
  });

  it("returns validation and permission errors as tool errors", async () => {
    const cw = await userWith(["caseworker"]);
    const client = await connect(cw);
    const bad = await client.callTool({ name: "clients_get", arguments: { id: "missing" } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0].text).toContain("not found");
  });
});
