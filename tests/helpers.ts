/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

export const CALLBACK_SECRET = "test-callback-secret";
export const WEBHOOK_SECRET = "test-webhook-secret";
export const WEBHOOK_URL = "https://n8n.test/webhook/lendloop";

export function makeBackend() {
  process.env.N8N_CALLBACK_SECRET = CALLBACK_SECRET;
  process.env.N8N_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.N8N_WEBHOOK_URL = WEBHOOK_URL;
  process.env.ADMIN_EMAILS = "root@example.com";
  return convexTest(schema, modules);
}

export type Backend = ReturnType<typeof makeBackend>;

export const identities = {
  alice: { subject: "clerk|alice", name: "Alice Lender", email: "alice@example.com", emailVerified: true },
  bob: { subject: "clerk|bob", name: "Bob Borrower", email: "bob@example.com", emailVerified: true },
  carol: { subject: "clerk|carol", name: "Carol Bystander", email: "carol@example.com", emailVerified: true },
  root: { subject: "clerk|root", name: "Root Admin", email: "root@example.com", emailVerified: true },
} as const;

/** Creates the profile row for an identity, like the dashboard does on first load. */
export async function signUp(t: Backend, who: keyof typeof identities) {
  const as = t.withIdentity(identities[who]);
  await as.mutation(api.users.ensure, {});
  return as;
}

export function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
