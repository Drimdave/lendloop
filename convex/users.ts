import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { clean } from "./lib/auth";
import { ConvexError, v } from "convex/values";

/** Creates the profile on first sign-in and keeps name and email fresh. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");
    const email = (identity.email ?? "").toLowerCase();
    const name = clean(identity.name ?? email.split("@")[0] ?? "Neighbour", 80) || "Neighbour";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    // Admins are bootstrapped from a server-side allow-list, and only when the
    // identity provider says the email is verified. Roles are never taken from
    // client input.
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin =
      identity.emailVerified === true && email !== "" && adminEmails.includes(email);

    return await ctx.db.insert("users", {
      subject: identity.subject,
      name,
      email,
      role: isAdmin ? "admin" : "user",
      trustedLender: false,
    });
  },
});

/** The caller's own profile (null when signed out or not yet created). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (!user) return null;
    return {
      id: user._id,
      name: user.name,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/** Admin only: mark or unmark a lender as trusted. */
export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError("User not found");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/** Admin only: list lenders so the dashboard can show the trusted toggle. */
export const listLenders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const tools = await ctx.db.query("tools").collect();
    const ownerIds = [...new Set(tools.map((t) => t.ownerId))];
    const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    return owners
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .map((o) => ({ id: o._id, name: o.name, trustedLender: o.trustedLender }));
  },
});
