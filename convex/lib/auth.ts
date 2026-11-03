import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * Returns the signed-in user's row, or throws. The identity comes only from the
 * verified JWT; nothing a client sends is trusted for who they are or their role.
 */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not signed in");
  const user = await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
    .unique();
  if (!user) throw new ConvexError("Profile not created yet; call users.ensure first");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new ConvexError("Admin only");
  return user;
}

export function clean(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
