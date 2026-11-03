import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { categoryValidator, conditionValidator } from "./schema";
import { clean, requireAdmin, requireUser } from "./lib/auth";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Public list for the landing page. Deliberately returns only name and category:
 * no owner, no description, no ids that could be used to reach a person.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const activeLoans = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const out = new Set(activeLoans.map((l) => l.toolId));
    return tools
      .filter((t) => !out.has(t._id))
      .map((t) => ({ name: t.name, category: t.category }));
  },
});

/** Signed-in browse view with availability, filterable by category. */
export const listAll = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    await requireUser(ctx);
    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .collect()
      : await ctx.db.query("tools").collect();
    const approved = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    const onLoan = new Set(approved.map((l) => l.toolId));
    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          ownerName: owner?.name ?? "Neighbour",
          ownerTrusted: owner?.trustedLender ?? false,
          ownerId: t.ownerId,
          available: !onLoan.has(t._id),
        };
      }),
    );
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    return tools.map((t) => ({
      id: t._id,
      name: t.name,
      category: t.category,
      condition: t.condition,
      description: t.description,
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const name = clean(args.name, 80);
    if (name.length < 2) throw new ConvexError("Name is too short");
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name,
      category: args.category,
      condition: args.condition,
      description: clean(args.description, 500),
    });
  },
});

/** Owners can edit only their own listings. */
export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) throw new ConvexError("Tool not found");
    if (tool.ownerId !== me._id) throw new ConvexError("You can only edit your own listings");
    const name = clean(args.name, 80);
    if (name.length < 2) throw new ConvexError("Name is too short");
    await ctx.db.patch(args.toolId, {
      name,
      category: args.category,
      condition: args.condition,
      description: clean(args.description, 500),
    });
  },
});

async function openLoansFor(ctx: QueryCtx, toolId: Id<"tools">) {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.filter((l) => l.status === "requested" || l.status === "approved");
}

/** Owners delete only their own listing, and not while a loan is open. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found");
    if (tool.ownerId !== me._id) throw new ConvexError("You can only delete your own listings");
    if ((await openLoansFor(ctx, toolId)).length > 0)
      throw new ConvexError("Resolve open requests and loans before deleting");
    await ctx.db.delete(toolId);
  },
});

/** Admin only: remove any listing. Open requests are cancelled, active loans closed. */
export const adminRemove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found");
    for (const loan of await openLoansFor(ctx, toolId)) {
      await ctx.db.patch(loan._id, { status: "cancelled" });
    }
    await ctx.db.delete(toolId);
  },
});
