import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { signPayload } from "./lib/hmac";
import { requireAdmin } from "./lib/auth";
import { todayUtc } from "./loans";

const EVENT_TYPE = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.returned"),
);
const RECIPIENT = v.union(v.literal("owner"), v.literal("borrower"));

// Retry delays in ms after attempt 1, 2 and 3. After the 4th failure we stop and
// leave a visible `failed` event instead of retrying forever.
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * Called from loan mutations. Creates one event row per (loan, type), which makes
 * the notification idempotent, then schedules delivery.
 */
export const queueNotification = internalMutation({
  args: { loanId: v.id("loans"), type: EVENT_TYPE, recipient: RECIPIENT },
  handler: async (ctx, { loanId, type, recipient }) => {
    const key = `notify:${loanId}:${type}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    const eventId = await ctx.db.insert("automationEvents", {
      key,
      loanId,
      kind: "request_notification",
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.automation.deliver, {
      eventId,
      type,
      recipient,
    });
    return eventId;
  },
});

/** The smallest payload n8n needs to write a message. No ids of people, no phone numbers. */
export const buildPayload = internalQuery({
  args: { eventId: v.id("automationEvents"), type: EVENT_TYPE, recipient: RECIPIENT },
  handler: async (ctx, { eventId, type, recipient }) => {
    const event = await ctx.db.get(eventId);
    if (!event?.loanId) return null;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return null;
    const [tool, owner, borrower] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.ownerId),
      ctx.db.get(loan.borrowerId),
    ]);
    const to = recipient === "owner" ? owner : borrower;
    const from = recipient === "owner" ? borrower : owner;
    if (!to || !tool) return null;
    return {
      eventId: String(event._id),
      eventKey: event.key,
      type,
      loanId: String(loan._id),
      status: loan.status,
      toolName: tool.name,
      startDate: loan.startDate,
      endDate: loan.endDate,
      recipient: { name: to.name, email: to.email },
      otherParty: { name: from?.name ?? "A neighbour" },
    };
  },
});

export const markEvent = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, status, attempts, detail }) => {
    await ctx.db.patch(eventId, {
      status,
      attempts,
      detail: detail?.slice(0, 300),
      updatedAt: Date.now(),
    });
  },
});

/** POSTs the signed event to the n8n webhook. Retries with backoff, then gives up visibly. */
export const deliver = internalAction({
  args: {
    eventId: v.id("automationEvents"),
    type: EVENT_TYPE,
    recipient: RECIPIENT,
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, type, recipient, attempt = 1 }) => {
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.markEvent, {
        eventId,
        status: "failed",
        attempts: attempt,
        detail: "N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET is not set; not retrying",
      });
      return;
    }
    const payload = await ctx.runQuery(internal.automation.buildPayload, {
      eventId,
      type,
      recipient,
    });
    if (!payload) {
      await ctx.runMutation(internal.automation.markEvent, {
        eventId,
        status: "failed",
        attempts: attempt,
        detail: "Loan or users no longer exist",
      });
      return;
    }
    const body = JSON.stringify(payload);
    let failure: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-signature": await signPayload(secret, body),
          "x-lendloop-event-id": payload.eventId,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      // Only an explicit acknowledgement counts. n8n answers 200 with an empty body when a
      // workflow dies before it responds, and that must not be mistaken for a delivery.
      const answer = (await res.json().catch(() => null)) as { status?: string } | null;
      if (!res.ok) failure = `n8n answered HTTP ${res.status}`;
      else if (answer?.status !== "sent" && answer?.status !== "duplicate")
        failure = "n8n did not acknowledge the delivery";
    } catch (err) {
      failure = err instanceof Error ? err.message : "network error";
    }
    if (!failure) {
      await ctx.runMutation(internal.automation.markEvent, {
        eventId,
        status: "sent",
        attempts: attempt,
      });
      return;
    }
    if (attempt < MAX_ATTEMPTS) {
      await ctx.runMutation(internal.automation.markEvent, {
        eventId,
        status: "pending",
        attempts: attempt,
        detail: `attempt ${attempt} failed: ${failure}`,
      });
      await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempt - 1], internal.automation.deliver, {
        eventId,
        type,
        recipient,
        attempt: attempt + 1,
      });
    } else {
      await ctx.runMutation(internal.automation.markEvent, {
        eventId,
        status: "failed",
        attempts: attempt,
        detail: `gave up after ${attempt} attempts: ${failure}`,
      });
    }
  },
});

/** Overdue loans that have not been reminded today. Read by n8n through /automation/overdue. */
export const overdueReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const approved = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const rows = [];
    for (const loan of approved) {
      if (loan.endDate >= today) continue;
      const key = `reminder:${loan._id}:${today}`;
      const done = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (done?.status === "sent") continue;
      const [tool, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.borrowerId)]);
      if (!tool || !borrower) continue;
      const daysOverdue = Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${loan.endDate}T00:00:00Z`)) / 86_400_000,
      );
      rows.push({
        loanId: String(loan._id),
        reminderKey: key,
        toolName: tool.name,
        dueDate: loan.endDate,
        daysOverdue,
        borrower: { name: borrower.name, email: borrower.email },
      });
    }
    return { date: today, loans: rows };
  },
});

/**
 * Idempotent write-back from n8n. The key is `reminder:<loanId>:<date>`, so a
 * retried or replayed call updates the same row instead of creating another.
 */
export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { loanId, reminderKey, status, detail }) => {
    const normalized = ctx.db.normalizeId("loans", loanId);
    if (!normalized) return { ok: false as const, error: "unknown loan" };
    const m = /^reminder:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(reminderKey);
    if (!m || m[1] !== loanId) return { ok: false as const, error: "bad reminderKey" };
    const today = todayUtc();
    const yesterday = todayUtc(Date.now() - 86_400_000);
    if (m[2] !== today && m[2] !== yesterday) return { ok: false as const, error: "stale reminderKey" };
    const loan = await ctx.db.get(normalized);
    if (!loan || loan.status !== "approved") return { ok: false as const, error: "loan not active" };

    const now = Date.now();
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", reminderKey))
      .unique();
    if (!existing) {
      await ctx.db.insert("automationEvents", {
        key: reminderKey,
        loanId: normalized,
        kind: "overdue_reminder",
        status,
        attempts: 1,
        detail: detail?.slice(0, 300),
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true as const, duplicate: false };
    }
    if (existing.status === "sent") return { ok: true as const, duplicate: true };
    await ctx.db.patch(existing._id, {
      status,
      attempts: existing.attempts + 1,
      detail: detail?.slice(0, 300),
      updatedAt: now,
    });
    return { ok: true as const, duplicate: false };
  },
});

/** Called by the n8n error workflow so failed runs are visible, not silent. */
export const recordFailure = internalMutation({
  args: {
    workflow: v.string(),
    node: v.string(),
    message: v.string(),
    executionId: v.string(),
  },
  handler: async (ctx, { workflow, node, message, executionId }) => {
    const key = `failure:${workflow.slice(0, 60)}:${executionId.slice(0, 60)}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) return { duplicate: true };
    const now = Date.now();
    await ctx.db.insert("automationEvents", {
      key,
      kind: "automation_failure",
      status: "failed",
      attempts: 1,
      detail: `${workflow} / ${node}: ${message}`.slice(0, 300),
      createdAt: now,
      updatedAt: now,
    });
    return { duplicate: false };
  },
});

/** Admin only: failed or still-retrying automation events, newest first, so failures are never silent. */
export const recentIssues = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("automationEvents").order("desc").take(200);
    return rows
      .filter((e) => e.status === "failed" || (e.status === "pending" && e.attempts > 0))
      .slice(0, 20)
      .map((e) => ({
        id: e._id,
        kind: e.kind,
        status: e.status,
        attempts: e.attempts,
        detail: e.detail ?? "",
        updatedAt: e.updatedAt,
      }));
  },
});
