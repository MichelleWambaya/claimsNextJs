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
      const body = await res.json().catch(() => ({}));
      setStatus(body.error || "Couldn't start the Microsoft connection.");
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
      setStatus(body.error || "Couldn't list that folder.");
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
    const res = await fetch("/api/ms-oauth/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, fileName: item.name, downloadUrl: item.downloadUrl }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatus(`Failed: ${body.error || res.statusText}`);
      return;
    }
    const body = await res.json();
    setStatus(`Ingested ${body.rowsIngested.toLocaleString()} rows from ${item.name}.`);
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
