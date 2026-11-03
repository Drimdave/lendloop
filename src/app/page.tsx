import Link from "next/link";
import { SignInButton, Show } from "@clerk/nextjs";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";

// The list changes whenever someone lends or borrows, so never cache it.
export const dynamic = "force-dynamic";

async function loadTools(): Promise<{ name: string; category: string }[] | null> {
  try {
    return await fetchQuery(api.tools.listPublic, {});
  } catch {
    return null;
  }
}

export default async function Home() {
  const tools = await loadTools();
  return (
    <main className="shell">
      <header className="hero">
        <p className="brand">LendLoop</p>
        <h1>Borrow what you need. Lend what you don&apos;t.</h1>
        <p className="lede">
          A neighbourhood board for sharing tools. Post the drill you use twice a year, or find one
          for the weekend.
        </p>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="btn primary">Sign in to lend or borrow</button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link className="btn primary" href="/dashboard">
            Open your dashboard
          </Link>
        </Show>
      </header>

      <section aria-labelledby="available">
        <h2 id="available">Available right now</h2>
        {tools === null ? (
          <p className="muted">The list could not be loaded. Please try again in a moment.</p>
        ) : tools.length === 0 ? (
          <p className="muted">Nothing is listed yet. Be the first to lend something.</p>
        ) : (
          <ul className="tool-grid">
            {tools.map((t, i) => (
              <li key={`${t.name}-${i}`} className="card">
                <span className="tool-name">{t.name}</span>
                <span className="pill">{t.category}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Owners and contact details stay private until you sign in.
        </p>
      </section>
    </main>
  );
}
