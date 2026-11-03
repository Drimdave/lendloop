"use client";

import { useEffect, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import BrowseTab from "./BrowseTab";
import MyListingsTab from "./MyListingsTab";
import MyRequestsTab from "./MyRequestsTab";
import IncomingTab from "./IncomingTab";
import AdminTab from "./AdminTab";

type TabId = "browse" | "listings" | "requests" | "incoming" | "admin";

export default function Dashboard() {
  return (
    <>
      <AuthLoading>
        <p className="muted shell">Signing you in...</p>
      </AuthLoading>
      <Unauthenticated>
        <p className="shell">
          Your session has ended. <Link href="/">Go back and sign in</Link>.
        </p>
      </Unauthenticated>
      <Authenticated>
        <Signed />
      </Authenticated>
    </>
  );
}

function Signed() {
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<TabId>("browse");
  const [failed, setFailed] = useState(false);

  // Creates the profile row on first sign-in. Safe to call again: it is a no-op for existing users.
  useEffect(() => {
    ensure({}).catch(() => setFailed(true));
  }, [ensure]);

  if (failed) return <p className="shell error">Could not set up your profile. Please reload.</p>;
  if (!me) return <p className="shell muted">Setting up your profile...</p>;

  const tabs: { id: TabId; label: string }[] = [
    { id: "browse", label: "Browse tools" },
    { id: "listings", label: "My listings" },
    { id: "requests", label: "My requests" },
    { id: "incoming", label: "Incoming requests" },
    ...(me.role === "admin" ? [{ id: "admin" as const, label: "Admin" }] : []),
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          LendLoop
        </Link>
        <div className="who">
          <span>{me.name}</span>
          {me.role === "admin" && <span className="badge badge-approved">admin</span>}
          {me.trustedLender && <span className="badge badge-returned">trusted lender</span>}
          <UserButton />
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Dashboard sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "browse" && <BrowseTab myId={me.id} />}
        {tab === "listings" && <MyListingsTab />}
        {tab === "requests" && <MyRequestsTab />}
        {tab === "incoming" && <IncomingTab />}
        {tab === "admin" && me.role === "admin" && <AdminTab />}
      </main>
    </div>
  );
}
