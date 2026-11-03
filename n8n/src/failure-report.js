// Turns an n8n error into a small, signed report for Convex. The message is cut
// short so a stack trace or an address inside an error text is not copied over.
const e = $json.execution ?? {};
const body = JSON.stringify({
  workflow: String($json.workflow?.name ?? 'unknown').slice(0, 60),
  node: String(e.lastNodeExecuted ?? 'unknown').slice(0, 60),
  message: String(e.error?.message ?? 'unknown error').slice(0, 200),
  executionId: String(e.id ?? Date.now()),
});
const t = Math.floor(Date.now() / 1000);
return [{ json: { body, t, message: `${t}.${body}` } }];
