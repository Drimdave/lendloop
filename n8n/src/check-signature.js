// Decides whether the webhook call is authentic. Fails closed on every doubt.
const { raw, header, t, v1, expected, secretConfigured } = $input.first().json;

// Constant-time comparison so timing does not leak how many characters matched.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

let reason = '';
if (!secretConfigured) reason = 'server not configured';
else if (!header) reason = 'missing';
else if (!t || !v1 || Number.isNaN(Number(t))) reason = 'malformed';
else if (Math.abs(Date.now() / 1000 - Number(t)) > 300) reason = 'expired';
else if (!safeEqual(String(expected), v1)) reason = 'mismatch';

let payload = null;
if (!reason) {
  try {
    payload = JSON.parse(raw);
  } catch {
    reason = 'bad json';
  }
}
// The payload is only passed on when the signature checked out.
return [{ json: { valid: reason === '', reason, payload } }];
