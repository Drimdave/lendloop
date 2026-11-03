// NOTIFY_CHANNEL=log: write the message to the n8n log instead of sending mail.
// Only the recipient's address and subject are logged, never the body.
console.log(`[lendloop] notification to ${$json.to}: ${$json.subject}`);
return [{ json: { ...$json, delivered: 'logged' } }];
