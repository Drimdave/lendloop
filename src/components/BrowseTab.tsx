"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES } from "../../convex/schema";
import { todayLocalIso } from "@/lib/format";
import { Empty, ErrorNote, useRunner } from "./ui";

type Category = (typeof CATEGORIES)[number];

export default function BrowseTab({ myId }: { myId: Id<"users"> }) {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.listAll, category ? { category } : {});

  return (
    <section>
      <div className="row">
        <h2>Browse tools</h2>
        <label className="inline">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {tools === undefined ? (
        <p className="muted">Loading...</p>
      ) : tools.length === 0 ? (
        <Empty>No tools in this category yet.</Empty>
      ) : (
        <ul className="list">
          {tools.map((t) => (
            <li key={t.id} className="card">
              <div className="row">
                <strong>{t.name}</strong>
                <span className="pill">{t.category}</span>
                <span className={t.available ? "badge badge-approved" : "badge badge-requested"}>
                  {t.available ? "available" : "on loan"}
                </span>
              </div>
              <p className="muted small">
                Condition: {t.condition} · Lender: {t.ownerName}
                {t.ownerTrusted ? " (trusted lender)" : ""}
              </p>
              {t.description && <p>{t.description}</p>}
              {t.ownerId === myId ? (
                <p className="muted small">This is your listing.</p>
              ) : (
                <RequestForm toolId={t.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const request = useMutation(api.loans.request);
  const { run, busy, error } = useRunner();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sent, setSent] = useState(false);

  if (!open)
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Request to borrow
      </button>
    );

  return (
    <form
      className="form-inline"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => request({ toolId, startDate: start, endDate: end }));
        if (ok) {
          setSent(true);
          setOpen(false);
        }
      }}
    >
      <label>
        From
        <input type="date" required min={todayLocalIso()} value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        Back by
        <input type="date" required min={start || todayLocalIso()} value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <button className="btn primary" disabled={busy}>
        {busy ? "Sending..." : "Send request"}
      </button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <ErrorNote message={error} />
      {sent && <p className="ok">Request sent.</p>}
    </form>
  );
}
