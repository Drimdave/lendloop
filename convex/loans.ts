import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { requireAdmin, requireUser } from "./lib/auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOAN_DAYS = 30;
const MAX_OPEN_REQUESTS_PER_BORROWER = 5;

export function todayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function parseDate(d: string): number {
  if (!DATE_RE.test(d)) throw new ConvexError("Dates must look like 2026-11-20");
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t)) throw new ConvexError("Invalid date");
  return t;
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / 86_400_000);
}

async function hasOverlap(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  start: string,
  end: string,
  ignoreLoanId?: Id<"loans">,
): Promise<boolean> {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.some(
    (l) =>
      l._id !== ignoreLoanId &&
      l.status === "approved" &&
      l.startDate <= end &&
      l.endDate >= start,
  );
}

/** Schedules the n8n notification. Only the minimum recipient fields leave Convex. */
async function notifyOther(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  type: "loan.requested" | "loan.approved" | "loan.declined" | "loan.cancelled" | "loan.returned",
  recipient: "owner" | "borrower",
) {
  await ctx.scheduler.runAfter(0, internal.automation.queueNotification, {
    loanId: loan._id,
    type,
    recipient,
  });
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found");
    if (tool.ownerId === me._id) throw new ConvexError("You cannot borrow your own tool");

    parseDate(startDate);
    parseDate(endDate);
    if (startDate < todayUtc()) throw new ConvexError("Start date is in the past");
    const days = daysBetween(startDate, endDate);
    if (days < 0) throw new ConvexError("End date is before the start date");
    if (days + 1 > MAX_LOAN_DAYS) throw new ConvexError(`Loans are limited to ${MAX_LOAN_DAYS} days`);

    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .collect();
    const open = mine.filter((l) => l.status === "requested" || l.status === "approved");
    if (open.length >= MAX_OPEN_REQUESTS_PER_BORROWER)
      throw new ConvexError("Too many open requests; wait for answers first");
    if (open.some((l) => l.toolId === toolId && l.startDate <= endDate && l.endDate >= startDate))
      throw new ConvexError("You already have a request for these dates");

    if (await hasOverlap(ctx, toolId, startDate, endDate))
      throw new ConvexError("Those dates are already booked");

    const loanId = await ctx.db.insert("loans", {
      toolId,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      status: "requested",
    });
    const loan = (await ctx.db.get(loanId))!;
    await notifyOther(ctx, loan, "loan.requested", "owner");
    return loanId;
  },
});

/** Lender only: approve or decline a request on their own tool. */
export const respond = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approve"), v.literal("decline")) },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Request not found");
    if (loan.ownerId !== me._id) throw new ConvexError("Only the lender can answer this request");
    if (loan.status !== "requested") throw new ConvexError("This request was already answered");

    if (decision === "approve") {
      if (await hasOverlap(ctx, loan.toolId, loan.startDate, loan.endDate, loan._id))
        throw new ConvexError("Another loan already covers these dates");
      await ctx.db.patch(loanId, { status: "approved" });
      await notifyOther(ctx, { ...loan, status: "approved" }, "loan.approved", "borrower");
    } else {
      await ctx.db.patch(loanId, { status: "declined" });
      await notifyOther(ctx, { ...loan, status: "declined" }, "loan.declined", "borrower");
    }
  },
});

/** Borrower only: withdraw a request that has not been answered. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Request not found");
    if (loan.borrowerId !== me._id) throw new ConvexError("You can only cancel your own request");
    if (loan.status !== "requested") throw new ConvexError("Only unanswered requests can be cancelled");
    await ctx.db.patch(loanId, { status: "cancelled" });
    await notifyOther(ctx, { ...loan, status: "cancelled" }, "loan.cancelled", "owner");
  },
});

/** Lender only: mark an approved loan as returned. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new ConvexError("Loan not found");
    if (loan.ownerId !== me._id) throw new ConvexError("Only the lender can mark a loan as returned");
    if (loan.status !== "approved") throw new ConvexError("Only approved loans can be returned");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await notifyOther(ctx, { ...loan, status: "returned" }, "loan.returned", "borrower");
  },
});

async function lastReminderAt(ctx: QueryCtx, loanId: Id<"loans">): Promise<number | null> {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .collect();
  const sent = events
    .filter((e) => e.kind === "overdue_reminder" && e.status === "sent")
    .map((e) => e.updatedAt);
  return sent.length ? Math.max(...sent) : null;
}

async function shape(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, owner, borrower] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
  ]);
  const overdue = loan.status === "approved" && loan.endDate < todayUtc();
  return {
    id: loan._id,
    toolName: tool?.name ?? "(removed listing)",
    ownerName: owner?.name ?? "Neighbour",
    borrowerName: borrower?.name ?? "Neighbour",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue,
    lastReminderAt: await lastReminderAt(ctx, loan._id),
  };
}

/** My requests: loans I am borrowing. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => shape(ctx, l)));
  },
});

/** Incoming requests: loans on my tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((l) => shape(ctx, l)));
  },
});

/** Admin only: every loan in the system. */
export const adminListAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").collect();
    return await Promise.all(loans.map((l) => shape(ctx, l)));
  },
});
