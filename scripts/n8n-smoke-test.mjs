// End-to-end check of the n8n side, using the REAL signing code from convex/lib/hmac.ts.
//
// It starts a stand-in for the Convex HTTP routes (verifying signatures with the same
// verifySignature the real routes use), then calls the n8n webhook the way Convex does.
//
//   node --experimental-strip-types scripts/n8n-smoke-test.mjs
//
// Environment (same values n8n was started with):
//   N8N_WEBHOOK_SECRET, N8N_CALLBACK_SECRET   required
//   N8N_BASE            default http://localhost:5678
//   MOCK_PORT           default 3999 (n8n must have CONVEX_SITE_URL pointing here)
//   N8N_EXECUTE_CMD     optional: command that runs the reminder workflow once, e.g.
//                       "docker compose exec -T n8n n8n execute --id=lendloopRemind01"
//   EXPECT_SEND_FAILURE set to 1 when n8n cannot send mail (checks the error path instead)
import http from "node:http";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { signPayload, verifySignature } from "../convex/lib/hmac.ts";

const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
const callbackSecret = process.env.N8N_CALLBACK_SECRET;
if (!webhookSecret || !callbackSecret) throw new Error("Set N8N_WEBHOOK_SECRET and N8N_CALLBACK_SECRET");
const base = process.env.N8N_BASE ?? "http://localhost:5678";
const port = Number(process.env.MOCK_PORT ?? 3999);
const expectFailure = process.env.EXPECT_SEND_FAILURE === "1";

const received = { reminders: [], failures: [], rejected: 0 };
const today = new Date().toISOString().slice(0, 10);

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf8");
  const check = await verifySignature(callbackSecret, body, req.headers["x-lendloop-signature"]);
  const send = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (!check.ok) {
    received.rejected++;
    return send(401, { error: check.reason });
  }
  if (req.method === "GET" && req.url === "/automation/overdue") {
    return send(200, {
      date: today,
      loans: [
        {
          loanId: "loan1",
          reminderKey: `reminder:loan1:${today}`,
          toolName: "Hedge trimmer",
          dueDate: "2026-10-30",
          daysOverdue: 3,
          borrower: { name: "Bob Borrower", email: "bob@example.com" },
        },
      ],
    });
  }
  if (req.method === "POST" && req.url === "/automation/reminder-sent") {
    received.reminders.push(JSON.parse(body));
    return send(200, { ok: true, duplicate: false });
  }
  if (req.method === "POST" && req.url === "/automation/failure") {
    received.failures.push(JSON.parse(body));
    return send(200, { duplicate: false });
  }
  send(404, { error: "not found" });
});
await new Promise((resolve) => server.listen(port, resolve));

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
}

const payload = (eventId) =>
  JSON.stringify({
    eventId,
    eventKey: `notify:loan1:loan.requested`,
    type: "loan.requested",
    loanId: "loan1",
    status: "requested",
    toolName: "Hedge trimmer",
    startDate: "2026-11-05",
    endDate: "2026-11-07",
    recipient: { name: "Alice Lender", email: "alice@example.com" },
    otherParty: { name: "Bob Borrower" },
  });

async function post(body, signature) {
  const res = await fetch(`${base}/webhook/lendloop-request`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-lendloop-signature": signature } : {}) },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const id = `evt_${Date.now()}`;
const body = payload(id);

if (!expectFailure) {
  const ok = await post(body, await signPayload(webhookSecret, body));
  check("signed webhook is accepted and delivered", ok.status === 200 && ok.json.status === "sent", JSON.stringify(ok));

  const again = await post(body, await signPayload(webhookSecret, body));
  check("the same event is not delivered twice", again.status === 200 && again.json.status === "duplicate", JSON.stringify(again));
} else {
  const res = await post(body, await signPayload(webhookSecret, body));
  check("a failed send returns an error so Convex retries", res.status >= 500, JSON.stringify(res));
  await new Promise((r) => setTimeout(r, 3000));
  check("the error workflow reported the failure to Convex", received.failures.length >= 1, JSON.stringify(received.failures));
}

const other = payload(`evt_other_${Date.now()}`);
check("missing signature is rejected", (await post(other)).status === 401);
check("wrong secret is rejected", (await post(other, await signPayload("wrong-secret", other))).status === 401);
check("tampered body is rejected", (await post(other + " ", await signPayload(webhookSecret, other))).status === 401);
const stale = await signPayload(webhookSecret, other, Math.floor(Date.now() / 1000) - 3600);
check("stale (replayed) signature is rejected", (await post(other, stale)).status === 401);
check("garbage signature is rejected", (await post(other, "t=abc,v1=zz")).status === 401);

if (process.env.N8N_EXECUTE_CMD) {
  // Async on purpose: this process also hosts the Convex stand-in that n8n calls during the run.
  try {
    await promisify(exec)(process.env.N8N_EXECUTE_CMD, { timeout: 120_000 });
  } catch (err) {
    console.log(String(err.stdout ?? "").split("\n").slice(-3).join("\n"));
  }
  const r = received.reminders[0];
  if (expectFailure) {
    check(
      "a reminder that could not be sent is written back as failed, not dropped",
      received.reminders.length === 1 && r.status === "failed" && Boolean(r.detail),
      JSON.stringify(received.reminders),
    );
  } else {
    check(
      "reminder workflow wrote back a signed, idempotent-keyed result",
      received.reminders.length === 1 && r.status === "sent" && r.reminderKey === `reminder:loan1:${today}`,
      JSON.stringify(received.reminders),
    );
  }
  check("Convex stand-in never rejected a signature from n8n", received.rejected === 0, `rejected=${received.rejected}`);
}

server.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
