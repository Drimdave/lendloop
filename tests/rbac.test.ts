import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { identities, isoDay, makeBackend, signUp, type Backend } from "./helpers";

let t: Backend;
beforeEach(() => {
  t = makeBackend();
});

const tool = { name: "Cordless drill", category: "power tools", condition: "good", description: "18V, two batteries" } as const;

describe("profiles and roles", () => {
  it("creates ordinary users as role user", async () => {
    const alice = await signUp(t, "alice");
    expect((await alice.query(api.users.me, {}))?.role).toBe("user");
  });

  it("makes an admin only for an allow-listed, verified email", async () => {
    const root = await signUp(t, "root");
    expect((await root.query(api.users.me, {}))?.role).toBe("admin");

    const unverified = t.withIdentity({ ...identities.root, subject: "clerk|fake", emailVerified: false });
    await unverified.mutation(api.users.ensure, {});
    expect((await unverified.query(api.users.me, {}))?.role).toBe("user");
  });

  it("rejects anonymous callers everywhere that needs a user", async () => {
    await expect(t.query(api.tools.listAll, {})).rejects.toThrow("Not signed in");
    await expect(t.query(api.tools.myListings, {})).rejects.toThrow("Not signed in");
    await expect(t.mutation(api.tools.create, tool)).rejects.toThrow("Not signed in");
    await expect(t.query(api.loans.incoming, {})).rejects.toThrow("Not signed in");
  });
});

describe("public list", () => {
  it("shows only name and category, nothing about the owner", async () => {
    const alice = await signUp(t, "alice");
    await alice.mutation(api.tools.create, tool);
    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toEqual([{ name: "Cordless drill", category: "power tools" }]);
    expect(Object.keys(rows[0]).sort()).toEqual(["category", "name"]);
  });

  it("hides tools that are currently on loan", async () => {
    const alice = await signUp(t, "alice");
    const bob = await signUp(t, "bob");
    const toolId = await alice.mutation(api.tools.create, tool);
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: isoDay(0), endDate: isoDay(2) });
    await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });
});

describe("listings", () => {
  it("lets users change and delete only their own listing", async () => {
    const alice = await signUp(t, "alice");
    const bob = await signUp(t, "bob");
    const toolId = await alice.mutation(api.tools.create, tool);

    await expect(bob.mutation(api.tools.update, { toolId, ...tool, name: "Hijacked" })).rejects.toThrow("your own listings");
    await expect(bob.mutation(api.tools.remove, { toolId })).rejects.toThrow("your own listings");

    await alice.mutation(api.tools.update, { toolId, ...tool, name: "Drill v2" });
    const mine = await alice.query(api.tools.myListings, {});
    expect(mine[0].name).toBe("Drill v2");
    await alice.mutation(api.tools.remove, { toolId });
    expect(await alice.query(api.tools.myListings, {})).toHaveLength(0);
  });

  it("filters the signed-in list by category and reports availability", async () => {
    const alice = await signUp(t, "alice");
    await alice.mutation(api.tools.create, tool);
    await alice.mutation(api.tools.create, { ...tool, name: "Tent", category: "camping" });
    const camping = await alice.query(api.tools.listAll, { category: "camping" });
    expect(camping.map((x) => x.name)).toEqual(["Tent"]);
    expect(camping[0].available).toBe(true);
  });

  it("only admins can remove other people's listings, and open requests are cancelled", async () => {
    const alice = await signUp(t, "alice");
    const bob = await signUp(t, "bob");
    const root = await signUp(t, "root");
    const toolId = await alice.mutation(api.tools.create, tool);
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(3) });

    await expect(bob.mutation(api.tools.adminRemove, { toolId })).rejects.toThrow("Admin only");
    await root.mutation(api.tools.adminRemove, { toolId });

    const all = await root.query(api.loans.adminListAll, {});
    expect(all.find((l) => l.id === loanId)?.status).toBe("cancelled");
    expect(await alice.query(api.tools.myListings, {})).toHaveLength(0);
  });
});

describe("loans", () => {
  async function setup() {
    const alice = await signUp(t, "alice");
    const bob = await signUp(t, "bob");
    const carol = await signUp(t, "carol");
    const toolId = await alice.mutation(api.tools.create, tool);
    return { alice, bob, carol, toolId };
  }

  it("blocks borrowing your own tool and bad dates", async () => {
    const { alice, bob, toolId } = await setup();
    await expect(alice.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) })).rejects.toThrow("your own tool");
    await expect(bob.mutation(api.loans.request, { toolId, startDate: isoDay(-1), endDate: isoDay(2) })).rejects.toThrow("in the past");
    await expect(bob.mutation(api.loans.request, { toolId, startDate: isoDay(3), endDate: isoDay(2) })).rejects.toThrow("before the start");
    await expect(bob.mutation(api.loans.request, { toolId, startDate: isoDay(0), endDate: isoDay(40) })).rejects.toThrow("limited to 30 days");
    await expect(bob.mutation(api.loans.request, { toolId, startDate: "tomorrow", endDate: "later" })).rejects.toThrow("Dates must look like");
  });

  it("lets only the lender answer a request", async () => {
    const { alice, bob, carol, toolId } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    await expect(bob.mutation(api.loans.respond, { loanId, decision: "approve" })).rejects.toThrow("Only the lender");
    await expect(carol.mutation(api.loans.respond, { loanId, decision: "approve" })).rejects.toThrow("Only the lender");
    await alice.mutation(api.loans.respond, { loanId, decision: "approve" });
    await expect(alice.mutation(api.loans.respond, { loanId, decision: "decline" })).rejects.toThrow("already answered");
  });

  it("scopes loan lists to the people involved", async () => {
    const { alice, bob, carol, toolId } = await setup();
    await bob.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    expect(await alice.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await bob.query(api.loans.myRequests, {})).toHaveLength(1);
    expect(await bob.query(api.loans.incoming, {})).toHaveLength(0);
    expect(await carol.query(api.loans.incoming, {})).toHaveLength(0);
    expect(await carol.query(api.loans.myRequests, {})).toHaveLength(0);
    await expect(carol.query(api.loans.adminListAll, {})).rejects.toThrow("Admin only");
  });

  it("lets only the borrower cancel, and only before an answer", async () => {
    const { alice, bob, carol, toolId } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    await expect(carol.mutation(api.loans.cancel, { loanId })).rejects.toThrow("your own request");
    await expect(alice.mutation(api.loans.cancel, { loanId })).rejects.toThrow("your own request");
    await bob.mutation(api.loans.cancel, { loanId });
    await expect(bob.mutation(api.loans.cancel, { loanId })).rejects.toThrow("Only unanswered");
  });

  it("refuses double bookings and lets the lender mark a loan returned", async () => {
    const { alice, bob, carol, toolId } = await setup();
    const first = await bob.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(4) });
    const second = await carol.mutation(api.loans.request, { toolId, startDate: isoDay(3), endDate: isoDay(5) });
    await alice.mutation(api.loans.respond, { loanId: first, decision: "approve" });
    await expect(alice.mutation(api.loans.respond, { loanId: second, decision: "approve" })).rejects.toThrow("already covers");
    await expect(carol.mutation(api.loans.request, { toolId, startDate: isoDay(2), endDate: isoDay(2) })).rejects.toThrow("already booked");

    await expect(bob.mutation(api.loans.markReturned, { loanId: first })).rejects.toThrow("Only the lender");
    await alice.mutation(api.loans.markReturned, { loanId: first });
    const rows = await alice.query(api.loans.incoming, {});
    expect(rows.find((l) => l.id === first)?.status).toBe("returned");
  });

  it("blocks deleting a listing that has an open request", async () => {
    const { alice, bob, toolId } = await setup();
    await bob.mutation(api.loans.request, { toolId, startDate: isoDay(1), endDate: isoDay(2) });
    await expect(alice.mutation(api.tools.remove, { toolId })).rejects.toThrow("Resolve open requests");
  });
});

describe("trusted lender", () => {
  it("can be set by an admin only", async () => {
    const alice = await signUp(t, "alice");
    const bob = await signUp(t, "bob");
    const root = await signUp(t, "root");
    const aliceId = (await alice.query(api.users.me, {}))!.id;
    await alice.mutation(api.tools.create, tool);

    await expect(bob.mutation(api.users.setTrustedLender, { userId: aliceId, trusted: true })).rejects.toThrow("Admin only");
    await expect(alice.mutation(api.users.setTrustedLender, { userId: aliceId, trusted: true })).rejects.toThrow("Admin only");
    await root.mutation(api.users.setTrustedLender, { userId: aliceId, trusted: true });

    const listed = await bob.query(api.tools.listAll, {});
    expect(listed[0].ownerTrusted).toBe(true);
    await expect(bob.query(api.users.listLenders, {})).rejects.toThrow("Admin only");
    expect(await root.query(api.users.listLenders, {})).toEqual([{ id: aliceId, name: "Alice Lender", trustedLender: true }]);
  });
});
