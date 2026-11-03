"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { LoanSummary, type LoanView } from "./LoanRow";
import { Empty, ErrorNote, useRunner } from "./ui";

export default function MyRequestsTab() {
  const loans = useQuery(api.loans.myRequests);
  return (
    <section>
      <h2>My requests</h2>
      {loans === undefined ? (
        <p className="muted">Loading...</p>
      ) : loans.length === 0 ? (
        <Empty>You have not asked to borrow anything yet. Try the Browse tab.</Empty>
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
  const cancel = useMutation(api.loans.cancel);
  const { run, busy, error } = useRunner();
  return (
    <li className="card">
      <LoanSummary loan={loan} party="borrower" />
      {loan.status === "requested" && (
        <button className="btn" disabled={busy} onClick={() => void run(() => cancel({ loanId: loan.id }))}>
          Cancel request
        </button>
      )}
      <ErrorNote message={error} />
    </li>
  );
}
