"use client";

import { useState } from "react";

type FolderItem = { id: string; name: string; size: number; downloadUrl?: string };

export default function SyncPanel({ sessionId }: { sessionId: string }) {
  const [folderPath, setFolderPath] = useState("");
  const [items, setItems] = useState<FolderItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    const res = await fetch("/api/ms-oauth/connect");
    if (!res.ok) {
      // BUG FIX: fell back to res.statusText, which is always "" on
      // HTTP/2 (what Vercel serves in production) — that produced the
      // blank "Failed: " message. Fall back to the HTTP status instead.
      const body = await res.json().catch(() => ({}));
      setStatus(body.error || `Couldn't start the Microsoft connection (HTTP ${res.status}).`);
      return;
    }
    const { authorizeUrl } = await res.json();
    window.location.href = authorizeUrl;
  }

  async function handleBrowse() {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/ms-oauth/sync?folderPath=${encodeURIComponent(folderPath)}`);
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus(body.error || `Couldn't list that folder (HTTP ${res.status}).`);
      setItems([]);
      return;
    }
    setItems(await res.json());
  }

  async function handleIngest(item: FolderItem) {
    if (!item.downloadUrl) {
      setStatus("That file has no direct download URL from Graph — try re-browsing the folder.");
      return;
    }
    setBusy(true);
    setStatus(`Ingesting ${item.name}…`);
    try {
      const res = await fetch("/api/ms-oauth/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, fileName: item.name, downloadUrl: item.downloadUrl }),
      });
      if (!res.ok) {
        // BUG FIX: same blank-statusText issue as above — this is what
        // was showing up as "Failed: -" (i.e. "Failed: " with nothing
        // after it) whenever the server error wasn't clean JSON, e.g. a
        // platform-level timeout/502 rather than our own error response.
        const body = await res.json().catch(() => ({}));
        setStatus(`Failed: ${body.error || `request failed (HTTP ${res.status})`}`);
        return;
      }
      const body = await res.json();
      setStatus(`Ingested ${body.rowsIngested.toLocaleString()} rows from ${item.name}.`);
    } catch (err) {
      // BUG FIX: fetch() itself can reject (network error, or the
      // serverless function timing out and the connection dropping
      // before any HTTP response comes back at all) — this wasn't
      // caught before, so it failed silently with `busy` stuck `true`
      // and no message shown.
      setStatus(`Failed: ${(err as Error).message || "network error — the request may have timed out"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">OneDrive / SharePoint sync</h1>

      <div className="border rounded-xl p-4 mb-4">
        <p className="text-sm text-gray-600 mb-3">
          Connect your Microsoft account once — this uses delegated OAuth, so it only ever accesses your own
          OneDrive, no tenant admin approval needed (unless your org blocks user consent entirely).
        </p>
        <button onClick={handleConnect} className="rounded-full px-4 py-2 text-sm border">
          Connect Microsoft account
        </button>
      </div>

      <div className="border rounded-xl p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Folder path, e.g. QA DATA SOURCE FILES"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            className="flex-1 border rounded-full px-4 py-2 text-sm"
          />
          <button onClick={handleBrowse} disabled={busy} className="rounded-full px-4 py-2 text-sm border disabled:opacity-50">
            Browse
          </button>
        </div>

        {items.length > 0 && (
          <div className="divide-y border rounded-lg">
            {items.map((item) => (
              <div key={item.id} className="flex justify-between items-center p-2 text-sm">
                <span>{item.name}</span>
                <button
                  onClick={() => handleIngest(item)}
                  disabled={busy}
                  className="text-aar-orange text-xs disabled:opacity-50"
                >
                  Ingest
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {status && <p className="text-sm text-gray-600">{status}</p>}

      <p className="text-xs text-gray-400 mt-4">
        Note: because this deployment processes files within a single request (no background job queue), a very
        large single file synced this way is bounded by your hosting plan's function timeout. For huge files,
        manual chunked upload (the Upload tab) is more reliable.
      </p>
    </div>
  );
}
