// HMAC-SHA256 signing shared by Convex (outbound to n8n, inbound from n8n).
// Signature header format: `t=<unix seconds>,v1=<hex>` over `${t}.${body}`.
// The same algorithm is implemented in the n8n Code nodes (see n8n/*.json).

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPayload(
  secret: string,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const sig = await hmacHex(secret, `${nowSeconds}.${body}`);
  return `t=${nowSeconds},v1=${sig}`;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

export async function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!header) return { ok: false, reason: "missing" };
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - t) > toleranceSeconds)
    return { ok: false, reason: "expired" };
  const expected = await hmacHex(secret, `${t}.${body}`);
  return safeEqual(expected, v1) ? { ok: true } : { ok: false, reason: "mismatch" };
}
