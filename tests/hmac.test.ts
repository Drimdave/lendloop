import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../convex/lib/hmac";

const secret = "s3cret";
const body = JSON.stringify({ hello: "world" });
const now = 1_800_000_000;

describe("HMAC signing", () => {
  it("accepts a fresh, untouched payload", async () => {
    const header = await signPayload(secret, body, now);
    expect(await verifySignature(secret, body, header, 300, now + 10)).toEqual({ ok: true });
  });

  it("rejects a tampered body", async () => {
    const header = await signPayload(secret, body, now);
    const result = await verifySignature(secret, body + " ", header, 300, now);
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects the wrong secret", async () => {
    const header = await signPayload("other", body, now);
    expect(await verifySignature(secret, body, header, 300, now)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a replay outside the tolerance window", async () => {
    const header = await signPayload(secret, body, now);
    const result = await verifySignature(secret, body, header, 300, now + 301);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a timestamp swapped in without re-signing", async () => {
    const header = await signPayload(secret, body, now);
    const swapped = header.replace(`t=${now}`, `t=${now + 1000}`);
    const result = await verifySignature(secret, body, swapped, 300, now + 1000);
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("reports missing and malformed headers", async () => {
    expect(await verifySignature(secret, body, null)).toEqual({ ok: false, reason: "missing" });
    expect(await verifySignature(secret, body, "nonsense")).toEqual({ ok: false, reason: "malformed" });
    expect(await verifySignature(secret, body, "t=abc,v1=ff")).toEqual({ ok: false, reason: "malformed" });
  });
});
