import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { signPayload, verifySignature } from "../convex/lib/hmac";
import {
  CALLBACK_SECRET,
  WEBHOOK_SECRET,
  WEBHOOK_URL,
  isoDay,
  makeBackend,
  signUp,
  type Backend,
} from "./helpers";

let t: Backend;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  t = makeBackend();
  fetchMock = vi.fn(async () => Response.json({ status: "sent" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tool = { name: "Hedge trimmer", category: "garden", condition: "good", description: "Electric" } as const;

async function requestLoan() {
  const alice = await signUp(t, "alice");
  const bob = await signUp(t, "bob");
  const toolId = await alice.mutation(api.tools.create, tool);
  const loanId = await bob.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(3) });
  return { alice, bob, toolId, loanId };
}

async function events(): Promise<{ key: string; status: string; attempts: number; detail?: string }[]> {
  return await t.run(async (ctx) => (await ctx.db.query("automationEvents").collect()).map((e) => ({ key: e.key, status: e.status, attempts: e.attempts, detail: e.detail })));
}

describe("request notification (Convex to n8n)", () => {
  it("sends a signed webhook with only the fields n8n needs", async () => {
    const { loanId } = await requestLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    const body = init.body as string;

    // Signature verifies with the shared secret and fails with any other.
    const header = (init.headers as Record<string, string>)["x-lendloop-signature"];
    expect(await verifySignature(WEBHOOK_SECRET, body, header)).toEqual({ ok: true });
    expect(await verifySignature("wrong", body, header)).toMatchObject({ ok: false });

    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      type: "loan.requested",
      loanId,
      toolName: "Hedge trimmer",
      status: "requested",
      recipient: { name: "Alice Lender", email: "alice@example.com" },
      otherParty: { name: "Bob Borrower" },
    });
    // Data minimisation: the borrower's email and every internal user id stay in Convex.
    expect(body).not.toContain("bob@example.com");
    expect(Object.keys(payload).sort()).toEqual(
      ["endDate", "eventId", "eventKey", "loanId", "otherParty", "recipient", "startDate", "status", "toolName", "type"],
    );
    expect((await events())[0]).toMatchObject({ key: `notify:${loanId}:loan.requested`, status: "sent", attempts: 1 });
  });

  it("notifies the borrower when the lender answers", async () => {
    const { alice, loanId } = await requestLoan();
    await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    const approved = bodies.find((b) => b.type === "loan.approved");
    expect(approved.recipient.email).toBe("bob@example.com");
    expect(approved.otherParty.name).toBe("Alice Lender");
  });

  it("retries with backoff and then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(Response.json({ status: "sent" }));
    await requestLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await events())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("does not count an empty 200 as delivered (n8n answers that when a workflow dies early)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 })).mockResolvedValueOnce(Response.json({ status: "duplicate" }));
    await requestLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await events())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("gives up after four attempts and leaves a visible failed event", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 500 }));
    await requestLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [event] = await events();
    expect(event.status).toBe("failed");
    expect(event.attempts).toBe(4);
    expect(event.detail).toContain("gave up after 4 attempts");
  });

  it("fails visibly, without retrying, when the secret is not configured", async () => {
    delete process.env.N8N_WEBHOOK_SECRET;
    await requestLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await events())[0]).toMatchObject({ status: "failed" });
  });

  it("queues each (loan, event type) once", async () => {
    const { loanId } = await requestLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(internal.automation.queueNotification, { loanId, type: "loan.requested", recipient: "owner" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await events()).toHaveLength(1);
  });
});

describe("dev helper", () => {
  it("is off by default and, when on, makes an approved loan overdue", async () => {
    const { alice, loanId } = await requestLoan();
    await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
    await expect(t.mutation(internal.dev.backdateLoan, { loanId, daysOverdue: 2 })).rejects.toThrow("Dev tools are off");

    process.env.ALLOW_DEV_TOOLS = "true";
    try {
      await t.mutation(internal.dev.backdateLoan, { loanId, daysOverdue: 2 });
    } finally {
      delete process.env.ALLOW_DEV_TOOLS;
    }
    const row = (await alice.query(api.loans.incoming, {})).find((l) => l.id === loanId)!;
    expect(row.overdue).toBe(true);
  });
});

describe("automation issues", () => {
  it("shows failed events to admins only", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 500 }));
    await requestLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const root = await signUp(t, "root");
    const issues = await root.query(api.automation.recentIssues, {});
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "request_notification", status: "failed", attempts: 4 });
    const bob = t.withIdentity({ subject: "clerk|bob", name: "Bob Borrower", email: "bob@example.com", emailVerified: true });
    await expect(bob.query(api.automation.recentIssues, {})).rejects.toThrow("Admin only");
  });
});

describe("HTTP endpoints (n8n to Convex)", () => {
  /** An approved loan that was due three days ago. The request API refuses past dates, so insert it directly. */
  async function insertOverdueLoan(): Promise<Id<"loans">> {
    const { toolId } = await requestLoan();
    return await t.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      const ownerId = users.find((u) => u.name === "Alice Lender")!._id;
      const borrowerId = users.find((u) => u.name === "Bob Borrower")!._id;
      return await ctx.db.insert("loans", { toolId, ownerId, borrowerId, startDate: isoDay(-10), endDate: isoDay(-3), status: "approved" });
    });
  }

  async function signed(path: string, method: "GET" | "POST", payload?: unknown, secret = CALLBACK_SECRET) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    return await t.fetch(path, {
      method,
      headers: { "content-type": "application/json", "x-lendloop-signature": await signPayload(secret, body) },
      ...(method === "POST" ? { body } : {}),
    });
  }

  it("rejects requests without a valid signature", async () => {
    expect((await t.fetch("/automation/overdue", { method: "GET" })).status).toBe(401);
    expect((await signed("/automation/overdue", "GET", undefined, "wrong")).status).toBe(401);
    const stale = await signPayload(CALLBACK_SECRET, "", Math.floor(Date.now() / 1000) - 3600);
    expect((await t.fetch("/automation/overdue", { method: "GET", headers: { "x-lendloop-signature": stale } })).status).toBe(401);
    expect((await t.fetch("/automation/reminder-sent", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await t.fetch("/automation/failure", { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("fails closed when the callback secret is not set", async () => {
    delete process.env.N8N_CALLBACK_SECRET;
    expect((await signed("/automation/overdue", "GET")).status).toBe(503);
  });

  it("returns only overdue approved loans, with minimal borrower fields", async () => {
    await requestLoan(); // a plain request is not overdue
    const loanId = await insertOverdueLoan();
    const res = await signed("/automation/overdue", "GET");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.loans).toHaveLength(1);
    expect(data.loans[0]).toMatchObject({
      loanId,
      toolName: "Hedge trimmer",
      daysOverdue: 3,
      borrower: { name: "Bob Borrower", email: "bob@example.com" },
      reminderKey: `reminder:${loanId}:${data.date}`,
    });
    expect(Object.keys(data.loans[0]).sort()).toEqual(["borrower", "daysOverdue", "dueDate", "loanId", "reminderKey", "toolName"]);
  });

  it("records a reminder once, even when n8n retries the write-back", async () => {
    const loanId = await insertOverdueLoan();
    const { date } = await (await signed("/automation/overdue", "GET")).json();
    const payload = { loanId, reminderKey: `reminder:${loanId}:${date}`, status: "sent" };

    const first = await (await signed("/automation/reminder-sent", "POST", payload)).json();
    expect(first).toEqual({ ok: true, duplicate: false });
    const second = await (await signed("/automation/reminder-sent", "POST", payload)).json();
    expect(second).toEqual({ ok: true, duplicate: true });

    const reminders = (await events()).filter((e) => e.key.startsWith("reminder:"));
    expect(reminders).toHaveLength(1);

    // Once reminded today, the loan drops out of today's overdue report.
    expect((await (await signed("/automation/overdue", "GET")).json()).loans).toHaveLength(0);
  });

  it("surfaces the reminder on the loan for the people involved", async () => {
    const loanId = await insertOverdueLoan();
    const { date } = await (await signed("/automation/overdue", "GET")).json();
    await signed("/automation/reminder-sent", "POST", { loanId, reminderKey: `reminder:${loanId}:${date}`, status: "sent" });
    const alice = t.withIdentity({ subject: "clerk|alice", name: "Alice Lender", email: "alice@example.com", emailVerified: true });
    const row = (await alice.query(api.loans.incoming, {})).find((l) => l.id === loanId)!;
    expect(row.overdue).toBe(true);
    expect(row.lastReminderAt).toEqual(expect.any(Number));
  });

  it("lets a failed reminder be retried and then marked sent", async () => {
    const loanId = await insertOverdueLoan();
    const { date } = await (await signed("/automation/overdue", "GET")).json();
    const key = `reminder:${loanId}:${date}`;
    await signed("/automation/reminder-sent", "POST", { loanId, reminderKey: key, status: "failed", detail: "smtp down" });
    expect((await (await signed("/automation/overdue", "GET")).json()).loans).toHaveLength(1);
    const retry = await (await signed("/automation/reminder-sent", "POST", { loanId, reminderKey: key, status: "sent" })).json();
    expect(retry).toEqual({ ok: true, duplicate: false });
    const stored = (await events()).find((e) => e.key === key)!;
    expect(stored).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("rejects malformed, mismatched, stale and unknown write-backs", async () => {
    const loanId = await insertOverdueLoan();
    expect((await signed("/automation/reminder-sent", "POST", { loanId })).status).toBe(400);
    const bad = await signed("/automation/reminder-sent", "POST", { loanId, reminderKey: "reminder:other:2026-01-01", status: "sent" });
    expect(bad.status).toBe(422);
    const stale = await signed("/automation/reminder-sent", "POST", { loanId, reminderKey: `reminder:${loanId}:2020-01-01`, status: "sent" });
    expect(stale.status).toBe(422);
    const unknown = await signed("/automation/reminder-sent", "POST", { loanId: "nope", reminderKey: "reminder:nope:2026-01-01", status: "sent" });
    expect(unknown.status).toBe(422);
  });

  it("records n8n failures once per execution", async () => {
    const payload = { workflow: "overdue-reminders", node: "Send email", message: "SMTP refused", executionId: "42" };
    expect((await (await signed("/automation/failure", "POST", payload)).json()).duplicate).toBe(false);
    expect((await (await signed("/automation/failure", "POST", payload)).json()).duplicate).toBe(true);
    const failures = (await events()).filter((e) => e.key.startsWith("failure:"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ status: "failed" });
    expect(failures[0].detail).toContain("SMTP refused");
  });
});
