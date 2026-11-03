// Runs after "Respond 502" has already told Convex the delivery failed (so Convex
// retries). Throwing here fails the execution, which starts the error workflow and
// records the failure in Convex for admins to see.
const reason = typeof $json.error === 'string' ? $json.error : $json.error?.message;
throw new Error(`Notification delivery failed: ${reason ?? 'unknown error'}`);
