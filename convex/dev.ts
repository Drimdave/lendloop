import { internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { todayUtc } from "./loans";

/**
 * Demo helper: moves an approved loan into the past so the overdue-reminder workflow
 * has something to find. The app refuses past dates on purpose, so this is the only way.
 * Internal (not callable from the browser) and off unless ALLOW_DEV_TOOLS=true.
 *
 *   npx convex env set ALLOW_DEV_TOOLS true
 *   npx convex run dev:backdateLoan '{"loanId":"<id>","daysOverdue":2}'
 */
export const backdateLoan = internalMutation({
  args: { loanId: v.id("loans"), daysOverdue: v.number() },
  handler: async (ctx, { loanId, daysOverdue }) => {
    if (process.env.ALLOW_DEV_TOOLS !== "true")
      throw new ConvexError("Dev tools are off. Set ALLOW_DEV_TOOLS=true on a development deployment only.");
    if (!Number.isInteger(daysOverdue) || daysOverdue < 1 || daysOverdue > 60)
      throw new ConvexError("daysOverdue must be a whole number from 1 to 60");
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.status !== "approved") throw new ConvexError("Only approved loans can be backdated");
    const day = 86_400_000;
    await ctx.db.patch(loanId, {
      startDate: todayUtc(Date.now() - (daysOverdue + 3) * day),
      endDate: todayUtc(Date.now() - daysOverdue * day),
    });
  },
});
