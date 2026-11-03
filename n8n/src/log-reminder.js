// NOTIFY_CHANNEL=log: write the reminder to the n8n log instead of sending mail.
console.log(`[lendloop] reminder to ${$json.to}: ${$json.subject}`);
return { json: { ...$json, delivered: 'logged' } };
