/**
 * MCP server, so an organisation can use Claude with the system.
 *
 * Authentication is a personal access token created by a real user on their
 * Account page. The server acts as that user: tools are filtered to what
 * their roles allow, every call goes through the same dispatcher as the web
 * app, and every read and write is audited with channel "mcp".
 *
 * Stateless Streamable HTTP: a fresh server per request, no sessions to store.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ops, type OpName } from "@ccm/shared";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import type { ZodObject, ZodRawShape } from "zod";
import { resolveCaller, type Ctx } from "./core/context.js";
import { sha256 } from "./core/crypto.js";
import { dispatch, hasPermission } from "./core/dispatch.js";
import { HttpsError } from "./core/errors.js";
import { C, db, REGION } from "./core/firebase.js";
import { TOKEN_PREFIX } from "./handlers/admin.js";

export const toolName = (op: string) => op.replace(/\./g, "_");

class AuthError extends Error {}

async function authenticate(header: string | undefined): Promise<Ctx> {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith(TOKEN_PREFIX)) throw new AuthError("Missing or malformed access token.");
  const ref = db.collection(C.apiTokens).doc(sha256(token));
  const snap = await ref.get();
  if (!snap.exists) throw new AuthError("Unknown access token.");
  if (snap.get("revokedAt")) throw new AuthError("This access token has been revoked.");
  if ((snap.get("expiresAt") as Timestamp).toMillis() < Date.now()) throw new AuthError("This access token has expired.");

  const uid = snap.get("uid") as string;
  const user = await db.collection(C.users).doc(uid).get();
  if (!user.exists) throw new AuthError("The user for this token no longer exists.");
  const ctx = await resolveCaller({ uid, email: user.get("email") }, "mcp");
  if (!ctx.can("mcp.use")) throw new AuthError("Your role doesn't include MCP access.");

  const lastUsed = (snap.get("lastUsedAt") as Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - lastUsed > 5 * 60_000) ref.update({ lastUsedAt: Timestamp.now() }).catch(() => undefined);
  return ctx;
}

export function buildServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: "charity-contact-management", version: "0.1.0" },
    {
      instructions: [
        `You are connected to the client management system for ${ctx.org.name}, acting as ${ctx.user.displayName}.`,
        "Every call you make is recorded in the audit log under this person's name.",
        "Client records contain personal and sometimes sensitive data. Only fetch what the task needs, and don't repeat sensitive details unnecessarily.",
        "Use clients_list to find a client's id before calling tools that need clientId. Use helpCategories_list, sessionTypes_list and questionSets_list to find ids for those.",
        "Dates and times are ISO 8601 with a timezone offset, for example 2026-03-14T10:00:00+00:00.",
      ].join(" "),
    },
  );

  for (const name of Object.keys(ops) as OpName[]) {
    const def = ops[name];
    if (!def.mcp || !hasPermission(ctx, def.permission)) continue;
    const schema = def.input as unknown as ZodObject<ZodRawShape>;
    server.registerTool(
      toolName(name),
      {
        title: name,
        description: def.description,
        inputSchema: schema.shape,
        annotations: { readOnlyHint: !def.write, destructiveHint: false, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        // Each call gets a fresh record of which clients it touched.
        const callCtx: Ctx = { ...ctx, touched: new Set() };
        try {
          const result = await dispatch(name, args, callCtx);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const message =
            err instanceof HttpsError
              ? `${err.message}${err.details ? ` ${JSON.stringify(err.details)}` : ""}`
              : "Something went wrong.";
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }
  return server;
}

export const mcp = onRequest({ region: REGION, maxInstances: 5, timeoutSeconds: 120 }, async (req, res) => {
  if (req.method !== "POST") {
    // Stateless server: no SSE stream to resume and no session to delete.
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    return;
  }
  let ctx: Ctx;
  try {
    ctx = await authenticate(req.headers.authorization);
  } catch (err) {
    const message = err instanceof AuthError || err instanceof HttpsError ? err.message : "Authentication failed.";
    res.status(401).set("WWW-Authenticate", 'Bearer realm="mcp"').json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null });
    return;
  }
  try {
    const server = buildServer(ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error("MCP request failed", err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
  }
});
