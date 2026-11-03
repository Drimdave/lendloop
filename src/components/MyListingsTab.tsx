"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS } from "../../convex/schema";
import { Empty, ErrorNote, useRunner } from "./ui";

type Category = (typeof CATEGORIES)[number];
type Condition = (typeof CONDITIONS)[number];
type Draft = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: Draft = { name: "", category: "other", condition: "good", description: "" };

export default function MyListingsTab() {
  const listings = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const { run, busy, error } = useRunner();
  const [draft, setDraft] = useState<Draft>(EMPTY);

  return (
    <section>
      <h2>My listings</h2>
      <form
        className="card form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => create(draft))) setDraft(EMPTY);
        }}
      >
        <h3>List a tool</h3>
        <DraftFields draft={draft} onChange={setDraft} />
        <button className="btn primary" disabled={busy}>
          {busy ? "Saving..." : "List tool"}
        </button>
        <ErrorNote message={error} />
      </form>

      {listings === undefined ? (
        <p className="muted">Loading...</p>
      ) : listings.length === 0 ? (
        <Empty>You have not listed anything yet.</Empty>
      ) : (
        <ul className="list">
          {listings.map((t) => (
            <Listing key={t.id} tool={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DraftFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <>
      <label>
        Name
        <input required minLength={2} maxLength={80} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <div className="row">
        <label>
          Category
          <select value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Condition
          <select value={draft.condition} onChange={(e) => onChange({ ...draft, condition: e.target.value as Condition })}>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Short description
        <textarea maxLength={500} rows={2} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
      </label>
    </>
  );
}

function Listing({ tool }: { tool: { id: Id<"tools">; name: string; category: Category; condition: Condition; description: string } }) {
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const { run, busy, error } = useRunner();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: tool.name, category: tool.category, condition: tool.condition, description: tool.description });

  if (editing)
    return (
      <li className="card">
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => update({ toolId: tool.id, ...draft }))) setEditing(false);
          }}
        >
          <DraftFields draft={draft} onChange={setDraft} />
          <div className="row">
            <button className="btn primary" disabled={busy}>Save</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
          <ErrorNote message={error} />
        </form>
      </li>
    );

  return (
    <li className="card">
      <div className="row">
        <strong>{tool.name}</strong>
        <span className="pill">{tool.category}</span>
        <span className="muted small">condition: {tool.condition}</span>
      </div>
      {tool.description && <p>{tool.description}</p>}
      <div className="row">
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${tool.name}"?`)) void run(() => remove({ toolId: tool.id }));
          }}
        >
          Delete
        </button>
      </div>
      <ErrorNote message={error} />
    </li>
  );
}
