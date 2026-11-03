// Builds the signed write-back for one loan. A failed send (the email node keeps
// going on error) is reported as "failed" instead of being dropped.
const ctx = $('Reminder message').item.json;
const failed = Boolean($json.error);
const body = JSON.stringify({
  loanId: ctx.loanId,
  reminderKey: ctx.reminderKey,
  status: failed ? 'failed' : 'sent',
  detail: failed ? String($json.error.message ?? $json.error).slice(0, 200) : undefined,
});
const t = Math.floor(Date.now() / 1000);
return { json: { body, t, message: `${t}.${body}`, failed } };
