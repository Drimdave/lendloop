# What I would change before production

Ordered by how much risk each one removes.

**Identity and access**
- Use a Clerk production instance with enforced email verification and MFA for admin accounts. Add a Clerk webhook so a deleted Clerk user also loses their Convex data (right to erasure), and write an admin audit log (who removed which listing, who changed a trusted-lender mark).
- Add rate limits on mutations (request, create listing) and bot protection on sign-up. Today only the per-borrower cap of 5 open requests slows an abuser down.

**The Convex and n8n boundary**
- Anyone who can edit a workflow in n8n can read `$env`, so the signing secrets are only as private as the n8n editor. In production put the editor behind SSO and a VPN or IP allow-list, move secrets to n8n's external secrets, and use a separate n8n project per environment.
- Add a key id to the signature header so secrets can be rotated without downtime (accept the old and new secret for a day).
- The 5-minute window allows a replay inside the window. Webhook events are deduplicated by event id on the n8n side, but the Convex callbacks would benefit from a stored nonce. The overdue `GET` can be replayed to re-read the same list; restrict the route by network as well.
- The delivered-event list lives in n8n workflow static data, which is fine for one instance but not for several workers. Use the database or Redis, or make Convex the source of truth by asking it before sending.

**Reliability and operations**
- Alert on `failed` automation events (Slack or pager) instead of relying on someone opening the admin tab. Add a "retry" button for failed events.
- Run n8n on Postgres with backups, behind HTTPS, with the image pinned by digest; queue mode if volume grows.
- Use a transactional email provider with SPF and DKIM, plus a way to opt out of reminders.
- Due dates are UTC days. Real use needs a per-user time zone and a clear "due by end of day" rule.

**Scale and correctness**
- Several queries collect whole tables (`tools.listAll`, the overdue scan). Add pagination and search, and an index on status plus end date for the overdue report.
- Reminders go out daily with no cap. Decide on a schedule (day 1, 3, 7) and an escalation to the lender.
- Add Playwright tests for the signed-in flows using Clerk testing tokens, and run the n8n smoke test against the docker stack in CI.

**If this handled sensitive personal data**
Tool lending is low sensitivity. For anything in a health or care setting I would also: keep message bodies free of personal detail and send only a link into the authenticated app, encrypt at rest with managed keys, log access to records, define retention periods and deletion jobs, and complete a data protection impact assessment before launch.
