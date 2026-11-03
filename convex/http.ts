import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifySignature } from "./lib/hmac";

const MAX_BODY_BYTES = 4096;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Every route checks an HMAC signature from n8n before doing anything. If the
 * secret is not configured the route fails closed with 503.
 */
async function authorise(req: Request, body: string): Promise<Response | null> {
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (!secret) return json({ error: "automation not configured" }, 503);
  const result = await verifySignature(secret, body, req.headers.get("x-lendloop-signature"));
  if (!result.ok) return json({ error: "invalid signature", reason: result.reason }, 401);
  return null;
}

const http = httpRouter();

// n8n reads overdue loans here (daily reminder workflow).
http.route({
  path: "/automation/overdue",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const denied = await authorise(req, ""); // GET has no body; the timestamp is still signed
    if (denied) return denied;
    return json(await ctx.runQuery(internal.automation.overdueReport, {}));
  }),
});

// n8n writes the reminder result back here. Safe to retry: keyed per loan per day.
http.route({
  path: "/automation/reminder-sent",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    if (body.length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
    const denied = await authorise(req, body);
    if (denied) return denied;
    let data: { loanId?: unknown; reminderKey?: unknown; status?: unknown; detail?: unknown };
    try {
      data = JSON.parse(body);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    if (
      typeof data.loanId !== "string" ||
      typeof data.reminderKey !== "string" ||
      (data.status !== "sent" && data.status !== "failed")
    )
      return json({ error: "invalid fields" }, 400);
    const result = await ctx.runMutation(internal.automation.recordReminder, {
      loanId: data.loanId,
      reminderKey: data.reminderKey,
      status: data.status,
      detail: typeof data.detail === "string" ? data.detail : undefined,
    });
    return json(result, result.ok ? 200 : 422);
  }),
});

// The n8n error workflow reports failed executions here.
http.route({
  path: "/automation/failure",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    if (body.length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
    const denied = await authorise(req, body);
    if (denied) return denied;
    let data: { workflow?: unknown; node?: unknown; message?: unknown; executionId?: unknown };
    try {
      data = JSON.parse(body);
    } catch {
      return json({ error: "invalid json" }, 400);
    }
    if (
      typeof data.workflow !== "string" ||
      typeof data.message !== "string" ||
      typeof data.executionId !== "string"
    )
      return json({ error: "invalid fields" }, 400);
    return json(
      await ctx.runMutation(internal.automation.recordFailure, {
        workflow: data.workflow,
        node: typeof data.node === "string" ? data.node : "unknown",
        message: data.message,
        executionId: data.executionId,
      }),
    );
  }),
});

export default http;
