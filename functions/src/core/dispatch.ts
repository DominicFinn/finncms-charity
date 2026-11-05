/**
 * Runs an operation: validates input, checks permission, calls the handler
 * and audits the read. Both the `api` callable and the MCP server come
 * through here, so the two channels behave identically.
 */
import { ops, type AuditAction, type OpName, type OpOutput, type OpParsedInput, type Permission } from "@ccm/shared";
import { logger } from "firebase-functions/v2";
import { auditNow } from "./audit.js";
import type { Ctx } from "./context.js";
import { fail, HttpsError } from "./errors.js";

export type Handler<N extends OpName> = (input: OpParsedInput<N>, ctx: Ctx) => Promise<OpOutput<N>>;
export type Handlers = { [N in OpName]: Handler<N> };
export type HandlerGroup = Partial<Handlers>;

let registry: Handlers | null = null;

export function registerHandlers(all: Handlers) {
  registry = all;
}

export function isOpName(name: unknown): name is OpName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(ops, name);
}

export function hasPermission(ctx: Ctx, required: Permission | Permission[] | "authenticated"): boolean {
  if (required === "authenticated") return true;
  const list = Array.isArray(required) ? required : [required];
  return list.some((p) => ctx.can(p));
}

function readAction(name: OpName): AuditAction {
  if (name === "clients.export" || name === "reports.exportCsv") return "export";
  if (name === "files.getDownloadUrl" || name === "meetingPapers.getDownloadUrl") return "download";
  if (name.endsWith(".list") || name === "users.directory" || name === "retention.upcoming") return "list";
  return "read";
}

/**
 * The Firebase callable SDK sends undefined object values as null, and some
 * MCP clients send null for "not given". Optional fields are treated as
 * absent when null. Answers keep their nulls, which mean "not answered".
 */
export function dropNulls(value: unknown, key?: string): unknown {
  if (key === "answers") return value;
  if (Array.isArray(value)) return value.map((v) => dropNulls(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = dropNulls(v, k);
    return out;
  }
  return value;
}

export async function dispatch<N extends OpName>(name: N, rawInput: unknown, ctx: Ctx): Promise<OpOutput<N>> {
  if (!registry) throw new Error("Handlers not registered");
  const def = ops[name];

  if (ctx.channel === "mcp" && !def.mcp) throw fail.denied("This operation is not available over MCP.");

  if (!hasPermission(ctx, def.permission)) {
    await auditNow(ctx, { action: "denied", entity: name.split(".")[0], op: name, detail: "Missing permission" });
    throw fail.denied();
  }

  const parsed = def.input.safeParse(dropNulls(rawInput ?? {}));
  if (!parsed.success) {
    throw fail.invalid(
      "Some of the details are not valid.",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const input = parsed.data as OpParsedInput<N>;

  try {
    const handler = registry[name] as Handler<N>;
    const result = await handler(input, ctx);
    if (!def.write) {
      const anyInput = input as Record<string, unknown>;
      const entityId = (anyInput.id ?? anyInput.clientId ?? anyInput.setId) as string | undefined;
      await auditNow(ctx, {
        action: readAction(name),
        entity: name.split(".")[0],
        entityId,
        clientIds: [...ctx.touched],
        op: name,
      });
    }
    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error(`Operation ${name} failed`, err);
    throw new HttpsError("internal", "Something went wrong. Please try again.");
  }
}
