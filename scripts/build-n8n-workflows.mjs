// Builds the importable n8n workflow files from the readable sources in n8n/src.
// Run `npm run build:n8n` after editing a Code node. No secrets are involved:
// every secret is read from the n8n environment at run time ($env.*).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "n8n");
const src = (name) => readFileSync(join(root, "src", `${name}.js`), "utf8").trimEnd() + "\n";

const SMTP_CREDENTIAL = { smtp: { id: "lendloop-smtp", name: "LendLoop SMTP" } };
const ERROR_WORKFLOW_ID = "lendloopError01";
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

let seq = 0;
const id = () => `n${++seq}`;

function code(name, file, position, mode) {
  return {
    id: id(),
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    parameters: { ...(mode ? { mode } : {}), jsCode: src(file) },
  };
}

function hmac(name, position, secretVar) {
  return {
    id: id(),
    name,
    type: "n8n-nodes-base.crypto",
    typeVersion: 1,
    position,
    parameters: {
      action: "hmac",
      type: "SHA256",
      value: "={{ $json.message }}",
      dataPropertyName: "expected",
      secret: `={{ $env.${secretVar} }}`,
      encoding: "hex",
    },
  };
}

function ifNode(name, position, leftValue, operator) {
  return {
    id: id(),
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [{ id: id(), leftValue, rightValue: operator.rightValue ?? "", operator: operator.operator }],
        combinator: "and",
      },
      options: {},
    },
  };
}

const isTrue = { operator: { type: "boolean", operation: "true", singleValue: true } };
const equals = (right) => ({ operator: { type: "string", operation: "equals" }, rightValue: right });

function respond(name, position, body, code) {
  return {
    id: id(),
    name,
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position,
    parameters: {
      respondWith: "json",
      responseBody: body,
      options: { responseCode: code },
    },
  };
}

function email(name, position, extra = {}) {
  return {
    id: id(),
    name,
    type: "n8n-nodes-base.emailSend",
    typeVersion: 2.1,
    position,
    parameters: {
      fromEmail: "={{ $env.MAIL_FROM }}",
      toEmail: "={{ $json.to }}",
      subject: "={{ $json.subject }}",
      emailFormat: "text",
      text: "={{ $json.text }}",
      options: {},
    },
    credentials: SMTP_CREDENTIAL,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    ...extra,
  };
}

function convexCall(name, position, method, path, withBody) {
  return {
    id: id(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    parameters: {
      method,
      url: `={{ $env.CONVEX_SITE_URL }}${path}`,
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "x-lendloop-signature", value: "=t={{ $json.t }},v1={{ $json.expected }}" }],
      },
      ...(withBody
        ? { sendBody: true, contentType: "raw", rawContentType: "application/json", body: "={{ $json.body }}" }
        : {}),
      options: { timeout: 15000 },
    },
    ...RETRY,
  };
}

function connect(list) {
  const out = {};
  for (const [from, to, outputIndex = 0] of list) {
    out[from] ??= { main: [] };
    while (out[from].main.length <= outputIndex) out[from].main.push([]);
    out[from].main[outputIndex].push({ node: to, type: "main", index: 0 });
  }
  return out;
}

function write(file, name, workflowId, nodes, connections, settings = {}) {
  const wf = {
    id: workflowId,
    name,
    active: false,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      // Successful runs keep no payload (it contains recipient emails); failed runs are kept for debugging.
      saveDataSuccessExecution: "none",
      saveDataErrorExecution: "all",
      ...settings,
    },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
  };
  writeFileSync(join(root, "workflows", file), JSON.stringify(wf, null, 2) + "\n");
}

// 1. Convex -> n8n: signed webhook, verified, deduplicated, delivered.
{
  const nodes = [
    {
      id: id(),
      name: "Convex webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 200],
      webhookId: "lendloop-request-webhook",
      parameters: {
        httpMethod: "POST",
        path: "lendloop-request",
        responseMode: "responseNode",
        options: { rawBody: true },
      },
    },
    code("Read signature input", "read-signature-input", [220, 200]),
    hmac("Compute HMAC", [440, 200], "N8N_WEBHOOK_SECRET"),
    code("Check signature", "check-signature", [660, 200]),
    ifNode("Signature valid?", [880, 200], "={{ $json.valid }}", isTrue),
    respond("Respond 401", [1100, 380], '={{ { error: "invalid signature", reason: $json.reason } }}', 401),
    code("Dedupe and render", "dedupe-and-render", [1100, 120]),
    ifNode("Already delivered?", [1320, 120], "={{ $json.alreadySent }}", isTrue),
    respond("Respond duplicate", [1540, 20], '={{ { status: "duplicate" } }}', 200),
    ifNode("Send by email?", [1540, 200], "={{ $env.NOTIFY_CHANNEL }}", equals("email")),
    email("Send email", [1760, 120], { onError: "continueErrorOutput" }),
    respond("Respond 502", [1980, 20], '={{ { error: "delivery failed" } }}', 502),
    code("Fail run", "fail-delivery", [2200, 20]),
    code("Log notification", "log-notification", [1760, 300]),
    code("Mark processed", "mark-processed", [1980, 200]),
    respond("Respond sent", [2200, 200], '={{ { status: "sent", eventId: $json.eventId } }}', 200),
  ];
  const connections = connect([
    ["Convex webhook", "Read signature input"],
    ["Read signature input", "Compute HMAC"],
    ["Compute HMAC", "Check signature"],
    ["Check signature", "Signature valid?"],
    ["Signature valid?", "Dedupe and render", 0],
    ["Signature valid?", "Respond 401", 1],
    ["Dedupe and render", "Already delivered?"],
    ["Already delivered?", "Respond duplicate", 0],
    ["Already delivered?", "Send by email?", 1],
    ["Send by email?", "Send email", 0],
    ["Send by email?", "Log notification", 1],
    ["Send email", "Mark processed", 0],
    ["Send email", "Respond 502", 1],
    ["Respond 502", "Fail run"],
    ["Log notification", "Mark processed"],
    ["Mark processed", "Respond sent"],
  ]);
  write("request-notification.json", "LendLoop - request notification", "lendloopNotify01", nodes, connections, {
    errorWorkflow: ERROR_WORKFLOW_ID,
  });
}

// 2. Daily overdue reminders: signed read from Convex, send, signed idempotent write-back.
{
  const nodes = [
    {
      id: id(),
      name: "Every day at 09:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 120],
      parameters: { rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 9 }] } },
    },
    {
      id: id(),
      name: "Run now (manual)",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 300],
      parameters: {},
    },
    code("Prepare read signature", "prepare-empty-signature", [220, 200]),
    hmac("Sign read", [440, 200], "N8N_CALLBACK_SECRET"),
    convexCall("Fetch overdue loans", [660, 200], "GET", "/automation/overdue", false),
    code("One item per loan", "one-item-per-loan", [880, 200]),
    code("Reminder message", "render-reminder", [1100, 200], "runOnceForEachItem"),
    ifNode("Send by email?", [1320, 200], "={{ $env.NOTIFY_CHANNEL }}", equals("email")),
    email("Send reminder email", [1540, 120], { onError: "continueRegularOutput" }),
    code("Log reminder", "log-reminder", [1540, 300], "runOnceForEachItem"),
    code("Prepare write-back", "prepare-writeback", [1760, 200], "runOnceForEachItem"),
    hmac("Sign write-back", [1980, 200], "N8N_CALLBACK_SECRET"),
    convexCall("Report to Convex", [2200, 200], "POST", "/automation/reminder-sent", true),
    code("Fail if any send failed", "fail-if-any-failed", [2420, 200]),
  ];
  const connections = connect([
    ["Every day at 09:00", "Prepare read signature"],
    ["Run now (manual)", "Prepare read signature"],
    ["Prepare read signature", "Sign read"],
    ["Sign read", "Fetch overdue loans"],
    ["Fetch overdue loans", "One item per loan"],
    ["One item per loan", "Reminder message"],
    ["Reminder message", "Send by email?"],
    ["Send by email?", "Send reminder email", 0],
    ["Send by email?", "Log reminder", 1],
    ["Send reminder email", "Prepare write-back"],
    ["Log reminder", "Prepare write-back"],
    ["Prepare write-back", "Sign write-back"],
    ["Sign write-back", "Report to Convex"],
    ["Report to Convex", "Fail if any send failed"],
  ]);
  write("overdue-reminders.json", "LendLoop - overdue reminders", "lendloopRemind01", nodes, connections, {
    errorWorkflow: ERROR_WORKFLOW_ID,
  });
}

// 3. Error workflow: makes failed runs visible in Convex (admin tab), never silent.
{
  const nodes = [
    {
      id: id(),
      name: "Error Trigger",
      type: "n8n-nodes-base.errorTrigger",
      typeVersion: 1,
      position: [0, 200],
      parameters: {},
    },
    code("Build failure report", "failure-report", [220, 200]),
    hmac("Sign failure report", [440, 200], "N8N_CALLBACK_SECRET"),
    convexCall("Report failure to Convex", [660, 200], "POST", "/automation/failure", true),
  ];
  const connections = connect([
    ["Error Trigger", "Build failure report"],
    ["Build failure report", "Sign failure report"],
    ["Sign failure report", "Report failure to Convex"],
  ]);
  write("error-handler.json", "LendLoop - error handler", ERROR_WORKFLOW_ID, nodes, connections);
}

console.log("n8n workflows written to", join(root, "workflows"));
