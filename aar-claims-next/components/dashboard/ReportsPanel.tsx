"use client";

import { useEffect, useState } from "react";

const CATEGORY_LABELS: Record<string, string> = {
  item_duplicate: "Duplicate items",
  non_payable: "Non-payable categories",
  pricing_anomaly: "Pricing anomalies",
  invalid_member_policy: "Invalid member/policy",
  diagnosis_gap: "Diagnosis gaps",
};

type ReportSummary = {
  id: string;
  report_type: string;
  category_filter: string | null;
  range_from: string | null;
  range_to: string | null;
  summary: { counts: Record<string, number>; totalAmount: number; totalFlags: number };
  created_at: string;
};

export default function ReportsPanel({ sessionId }: { sessionId: string }) {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selected, setSelected] = useState<ReportSummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [category, setCategory] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  async function loadReports() {
    const res = await fetch(`/api/reports?sessionId=${sessionId}`);
    if (res.ok) setReports(await res.json());
  }

  useEffect(() => {
    loadReports();
  }, [sessionId]);

  async function handleGenerate() {
    setGenerating(true);
    const res = await fetch("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, categoryFilter: category || undefined, rangeFrom: rangeFrom || undefined, rangeTo: rangeTo || undefined }),
    });
    setGenerating(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`Couldn't generate report: ${body.error || res.statusText}`);
      return;
    }
    const report = await res.json();
    setSelected(report);
    await loadReports();
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold mb-4">Reports</h1>

      <div className="border rounded-xl p-4 mb-6 flex gap-2 flex-wrap items-center">
        <select className="border rounded-full px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <input type="date" className="border rounded-full px-3 py-2 text-sm" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
        <input type="date" className="border rounded-full px-3 py-2 text-sm" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-full px-4 py-2 text-sm bg-aar-orange text-white disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate report"}
        </button>
      </div>

      {selected && (
        <div className="border rounded-xl p-8 mb-6 text-center bg-gray-50">
          <div className="text-xs uppercase tracking-wide text-gray-500">AAR claims forensic audit</div>
          <div className="text-lg font-medium mt-2">
            {selected.range_from || "all time"} to {selected.range_to || "present"}
            {selected.category_filter ? ` — ${CATEGORY_LABELS[selected.category_filter]}` : " — all categories"}
          </div>
          <div className="text-5xl font-semibold mt-4">{selected.summary.totalFlags}</div>
          <div className="text-sm text-gray-500">total flags identified</div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
            {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
              <div key={k} className="bg-white rounded-xl p-4">
                <div className="text-2xl font-semibold">{selected.summary.counts[k] || 0}</div>
                <div className="text-xs text-gray-500 mt-1">{l}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl p-6 mt-6">
            <div className="text-sm text-gray-500">Total flagged claim amount</div>
            <div className="text-3xl font-semibold">
              {selected.summary.totalAmount.toLocaleString(undefined, { style: "currency", currency: "KES" })}
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="font-medium text-sm mb-2">Past reports</div>
        {reports.length === 0 && <p className="text-sm text-gray-400">No reports generated yet.</p>}
        <div className="border rounded-xl divide-y">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className="w-full text-left p-3 text-sm hover:bg-gray-50 flex justify-between"
            >
              <span>
                {new Date(r.created_at).toLocaleString()} — {r.category_filter ? CATEGORY_LABELS[r.category_filter] : "All categories"}
                {" — "}
                {r.range_from || "all time"} to {r.range_to || "present"}
              </span>
              <span className="text-gray-500">{r.summary.totalFlags} flags</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
