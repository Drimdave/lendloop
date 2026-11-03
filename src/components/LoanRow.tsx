"use client";

import { timeAgo } from "@/lib/format";
import { StatusBadge } from "./ui";

export type LoanView = {
  id: string;
  toolName: string;
  ownerName: string;
  borrowerName: string;
  startDate: string;
  endDate: string;
  status: string;
  overdue: boolean;
  lastReminderAt: number | null;
};

/** Shared card body. The automation line is the "recent activity per loan" bonus. */
export function LoanSummary({ loan, party }: { loan: LoanView; party: "lender" | "borrower" | "both" }) {
  return (
    <>
      <div className="row">
        <strong>{loan.toolName}</strong>
        <StatusBadge status={loan.status} overdue={loan.overdue} />
      </div>
      <p className="muted small">
        {loan.startDate} to {loan.endDate}
        {party === "lender" && ` · Borrower: ${loan.borrowerName}`}
        {party === "borrower" && ` · Lender: ${loan.ownerName}`}
        {party === "both" && ` · ${loan.ownerName} lends to ${loan.borrowerName}`}
      </p>
      {loan.lastReminderAt !== null && (
        <p className="small automation">Reminder sent {timeAgo(loan.lastReminderAt)}</p>
      )}
    </>
  );
}
