"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/format";

/** Runs a mutation and keeps the busy flag and a friendly error in one place. */
export function useRunner() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}

export function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  const label = overdue ? "overdue" : status;
  return <span className={`badge badge-${label}`}>{label}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted empty">{children}</p>;
}
