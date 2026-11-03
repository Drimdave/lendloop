"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { LoanSummary, type LoanView } from "./LoanRow";
import { Empty, ErrorNote, useRunner } from "./ui";

export default function IncomingTab() {
  const loans = useQuery(api.loans.incoming);
  return (
    <section>
      <h2>Incoming requests</h2>
      {loans === undefined ? (
        <p className="muted">Loading...</p>
      ) : loans.length === 0 ? (
        <Empty>Nobody has asked to borrow your tools yet.</Empty>
      ) : (
        <ul className="list">
          {loans.map((l) => (
            <Row key={l.id} loan={l} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ loan }: { loan: LoanView & { id: Id<"loans"> } }) {
  const respond = useMutation(api.loans.respond);
  const markReturned = useMutation(api.loans.markReturned);
  const { run, busy, error } = useRunner();
  return (
    <li className="card">
      <LoanSummary loan={loan} party="lender" />
      <div className="row">
        {loan.status === "requested" && (
          <>
            <button className="btn primary" disabled={busy} onClick={() => void run(() => respond({ loanId: loan.id, decision: "approve" }))}>
              Approve
            </button>
            <button className="btn" disabled={busy} onClick={() => void run(() => respond({ loanId: loan.id, decision: "decline" }))}>
              Decline
            </button>
          </>
        )}
        {loan.status === "approved" && (
          <button className="btn" disabled={busy} onClick={() => void run(() => markReturned({ loanId: loan.id }))}>
            Mark returned
          </button>
        )}
      </div>
      <ErrorNote message={error} />
    </li>
  );
}
