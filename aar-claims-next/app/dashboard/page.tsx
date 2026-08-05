"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import DashboardContent from "@/components/dashboard/DashboardContent";
import UploadPanel from "@/components/dashboard/UploadPanel";
import ReportsPanel from "@/components/dashboard/ReportsPanel";
import SyncPanel from "@/components/dashboard/SyncPanel";

type Tab = "dashboard" | "upload" | "reports" | "sync";

export default function DashboardPage() {
  const supabase = createClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      // Reuse the most recent existing session rather than always
      // creating a new one — this is the fix for the exact bug the
      // Docker version had, where logging out orphaned prior uploads
      // behind a session id nothing pointed to anymore.
      const listRes = await fetch("/api/sessions");
      if (!listRes.ok) {
        setError("Couldn't load sessions.");
        return;
      }
      const sessions = await listRes.json();
      if (sessions.length > 0) {
        setSessionId(sessions[0].id);
        return;
      }
      const createRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Default Session" }),
      });
      if (!createRes.ok) {
        setError("Couldn't create a session.");
        return;
      }
      const created = await createRes.json();
      setSessionId(created.id);
    })();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (error) {
    return <div className="p-8 text-red-600">{error}</div>;
  }
  if (!sessionId) {
    return <div className="p-8 text-gray-400">Setting up your session…</div>;
  }

  const NAV: { key: Tab; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "upload", label: "Upload" },
    { key: "reports", label: "Reports" },
    { key: "sync", label: "Sync" },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="w-52 border-r p-4 flex flex-col">
        <div className="font-semibold mb-6">
          AAR <span className="text-aar-orange">Audit</span>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`text-left ${tab === item.key ? "font-semibold text-aar-black" : "text-gray-500"}`}
            >
              {item.label}
            </button>
          ))}
          <button onClick={handleLogout} className="text-left text-gray-400 mt-6">
            Log out
          </button>
        </nav>
      </aside>
      <main className="flex-1">
        {tab === "dashboard" && <DashboardContent sessionId={sessionId} key={refreshKey} />}
        {tab === "upload" && (
          <div className="p-6 max-w-2xl">
            <UploadPanel sessionId={sessionId} onDone={() => setRefreshKey((k) => k + 1)} />
          </div>
        )}
        {tab === "reports" && <ReportsPanel sessionId={sessionId} />}
        {tab === "sync" && <SyncPanel sessionId={sessionId} />}
      </main>
    </div>
  );
}
