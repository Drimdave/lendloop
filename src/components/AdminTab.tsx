"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import { LoanSummary } from "./LoanRow";
import { Empty, ErrorNote, useRunner } from "./ui";

export default function AdminTab() {
  const loans = useQuery(api.loans.adminListAll);
  const tools = useQuery(api.tools.listAll, {});
  const lenders = useQuery(api.users.listLenders);
  const issues = useQuery(api.automation.recentIssues);
  const removeTool = useMutation(api.tools.adminRemove);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { run, busy, error } = useRunner();

  return (
    <section>
      <h2>Admin</h2>
      <ErrorNote message={error} />

      <h3>Automation issues</h3>
      {issues === undefined ? (
        <p className="muted">Loading...</p>
      ) : issues.length === 0 ? (
        <Empty>No failed or retrying automation events.</Empty>
      ) : (
        <ul className="list">
          {issues.map((e) => (
            <li key={e.id} className="card">
              <div className="row">
                <strong>{e.kind.replace("_", " ")}</strong>
                <span className={e.status === "failed" ? "badge badge-overdue" : "badge badge-requested"}>{e.status}</span>
                <span className="muted small">
                  {e.attempts} attempt{e.attempts === 1 ? "" : "s"} · {timeAgo(e.updatedAt)}
                </span>
              </div>
              {e.detail && <p className="small">{e.detail}</p>}
            </li>
          ))}
        </ul>
      )}

      <h3>Lenders</h3>
      {lenders === undefined ? (
        <p className="muted">Loading...</p>
      ) : lenders.length === 0 ? (
        <Empty>No lenders yet.</Empty>
      ) : (
        <ul className="list">
          {lenders.map((l) => (
            <li key={l.id} className="card row">
              <strong>{l.name}</strong>
              <span className="muted small">{l.trustedLender ? "Trusted lender" : "Not marked trusted"}</span>
              <button
                className="btn"
                disabled={busy}
                onClick={() => void run(() => setTrusted({ userId: l.id as Id<"users">, trusted: !l.trustedLender }))}
              >
                {l.trustedLender ? "Remove trusted mark" : "Mark as trusted lender"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>All listings</h3>
      {tools === undefined ? (
        <p className="muted">Loading...</p>
      ) : tools.length === 0 ? (
        <Empty>No listings.</Empty>
      ) : (
        <ul className="list">
          {tools.map((t) => (
            <li key={t.id} className="card row">
              <strong>{t.name}</strong>
              <span className="muted small">by {t.ownerName}</span>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove "${t.name}"? Open requests will be cancelled.`))
                    void run(() => removeTool({ toolId: t.id }));
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>All loans</h3>
      {loans === undefined ? (
        <p className="muted">Loading...</p>
      ) : loans.length === 0 ? (
        <Empty>No loans yet.</Empty>
      ) : (
        <ul className="list">
          {loans.map((l) => (
            <li key={l.id} className="card">
              <LoanSummary loan={l} party="both" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
