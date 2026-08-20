"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line,
} from "recharts";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "", label: "All categories (consolidated)" },
  { key: "item_duplicate", label: "Duplicate items" },
  { key: "non_payable", label: "Non-payable categories" },
  { key: "pricing_anomaly", label: "Pricing anomalies" },
  { key: "invalid_member_policy", label: "Invalid member/policy" },
  { key: "diagnosis_gap", label: "Diagnosis gaps" },
];

const FLAGS_PAGE_SIZE = 1000;

type FlagRow = {
  id: string;
  flag_type: string;
  reason: string;
  detail: Record<string, unknown>;
  claim_row_id: string;
  claim_rows: {
    member_id: string | null;
    product_name: string | null;
    provider: string | null;
    approved_amount: number | null;
    visit_date: string | null;
  } | null;
};

// BUG FIX: `new Date(...).toISOString().slice(0, 10)` converts a
// locally-constructed date to UTC before slicing. For any timezone
// ahead of UTC (e.g. Nairobi, UTC+3 — this is an AAR Kenya deployment),
// a local midnight boundary rolls back into the previous UTC calendar
// day, so "this month"/"this year" ranges silently excluded the last
// day of the period from every chart, table, and export. Format using
// the Date's own local fields instead of going through UTC.
function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DashboardContent({ sessionId }: { sessionId: string }) {
  const supabase = createClient();

  const [category, setCategory] = useState("");
  const [rangeMode, setRangeMode] = useState<"month" | "year" | "custom">("month");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  const resolvedRange = useMemo(() => {
    const now = new Date();
    if (rangeMode === "month") {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: toLocalISODate(from), to: toLocalISODate(to) };
    }
    if (rangeMode === "year") {
      return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    }
    return { from: rangeFrom, to: rangeTo };
  }, [rangeMode, rangeFrom, rangeTo]);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    // BUG FIX: this used to be a single query with `.limit(2000)`, which
    // silently truncated the dashboard's numbers for any session with
    // more than 2000 flags — the UI gave no indication the totals were
    // partial. Paginate through all matching rows instead, same
    // approach used server-side in /api/flags/recompute.
    const allRows: FlagRow[] = [];
    let from = 0;
    while (true) {
      let query = supabase
        .from("flags")
        .select(
          "id, flag_type, reason, detail, claim_row_id, claim_rows(member_id, product_name, provider, approved_amount, visit_date)"
        )
        .eq("audit_session_id", sessionId)
        .range(from, from + FLAGS_PAGE_SIZE - 1);
      if (category) query = query.eq("flag_type", category);

      const { data, error } = await query;
      if (error || !data) break;
      allRows.push(...(data as unknown as FlagRow[]));
      if (data.length < FLAGS_PAGE_SIZE) break;
      from += FLAGS_PAGE_SIZE;
    }
    setFlags(allRows);
    setLoading(false);
  }, [supabase, sessionId, category]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  async function handleRecompute() {
    setRecomputing(true);
    try {
      const res = await fetch("/api/flags/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, rangeFrom: resolvedRange.from, rangeTo: resolvedRange.to }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Recompute failed: ${body.error || res.statusText}`);
        return;
      }
      await loadFlags();
    } finally {
      setRecomputing(false);
    }
  }

  const inRange = useMemo(() => {
    return flags.filter((f) => {
      const d = f.claim_rows?.visit_date;
      if (!d) return false;
      if (resolvedRange.from && d < resolvedRange.from) return false;
      if (resolvedRange.to && d > resolvedRange.to) return false;
      return true;
    });
  }, [flags, resolvedRange]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of inRange) c[f.flag_type] = (c[f.flag_type] || 0) + 1;
    return c;
  }, [inRange]);

  const categoryChartData = CATEGORIES.filter((c) => c.key).map((c) => ({
    name: c.label.replace(" categories", "").replace(" items", ""),
    count: counts[c.key] || 0,
  }));

  const trendData = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const f of inRange) {
      const d = f.claim_rows?.visit_date;
      const key = d ? d.slice(0, 7) : "unknown";
      buckets[key] = (buckets[key] || 0) + 1;
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, count]) => ({ period, count }));
  }, [inRange]);

  const totalAmount = useMemo(
    () => inRange.reduce((sum, f) => sum + Number(f.claim_rows?.approved_amount || 0), 0),
    [inRange]
  );

  function exportExcel() {
    const rows = inRange.map((f) => ({
      Member: f.claim_rows?.member_id ?? "",
      Product: f.claim_rows?.product_name ?? "",
      Provider: f.claim_rows?.provider ?? "",
      Amount: f.claim_rows?.approved_amount ?? 0,
      VisitDate: f.claim_rows?.visit_date ?? "",
      FlagType: f.flag_type,
      Reason: f.reason,
    }));
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No flags in this selection" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Flags");
    XLSX.writeFile(wb, `aar_claims_report_${resolvedRange.from}_${resolvedRange.to}.xlsx`);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">AAR Claims QA</h1>
          <p className="text-sm text-gray-500">{loading ? "Loading…" : `${inRange.length} flags in range`}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            className="border rounded-full px-4 py-2 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="border rounded-full px-4 py-2 text-sm"
            value={rangeMode}
            onChange={(e) => setRangeMode(e.target.value as "month" | "year" | "custom")}
          >
            <option value="month">This month</option>
            <option value="year">This year</option>
            <option value="custom">Custom range</option>
          </select>
          {rangeMode === "custom" && (
            <>
              <input type="date" className="border rounded-full px-3 py-2 text-sm" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
              <input type="date" className="border rounded-full px-3 py-2 text-sm" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
            </>
          )}
          <button
            onClick={handleRecompute}
            disabled={recomputing}
            className="rounded-full px-4 py-2 text-sm bg-orange-500 text-white disabled:opacity-50"
          >
            {recomputing ? "Generating…" : "Generate"}
          </button>
          <button onClick={exportExcel} className="rounded-full px-4 py-2 text-sm border">
            Export to Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        {["Total", "item_duplicate", "non_payable", "pricing_anomaly", "invalid_member_policy", "diagnosis_gap"].map(
          (key) => (
            <div key={key} className="bg-gray-50 rounded-xl p-4">
              <div className="text-2xl font-semibold">{key === "Total" ? inRange.length : counts[key] || 0}</div>
              <div className="text-xs text-gray-500 mt-1">
                {key === "Total" ? "Total flags" : CATEGORIES.find((c) => c.key === key)?.label}
              </div>
            </div>
          )
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="border rounded-xl p-4">
          <div className="text-sm font-medium mb-2">Flags by category</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={categoryChartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#2a78d6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="border rounded-xl p-4">
          <div className="text-sm font-medium mb-2">Flags over time</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#1a1a1a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="border rounded-xl p-4 mb-4">
        <div className="text-sm text-gray-500">Total flagged amount — {category ? CATEGORIES.find(c=>c.key===category)?.label : "all categories"}</div>
        <div className="text-2xl font-semibold">
          {totalAmount.toLocaleString(undefined, { style: "currency", currency: "KES" })}
        </div>
      </div>

      <div className="border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-gray-500">
              <th className="p-2">Member</th>
              <th className="p-2">Product</th>
              <th className="p-2">Provider</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {inRange.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-400">
                  No flags for this selection. Click Generate to recompute.
                </td>
              </tr>
            )}
            {inRange.slice(0, 200).map((f) => (
              <tr key={f.id} className="border-b">
                <td className="p-2">{f.claim_rows?.member_id}</td>
                <td className="p-2">{f.claim_rows?.product_name}</td>
                <td className="p-2">{f.claim_rows?.provider}</td>
                <td className="p-2 text-right">{Number(f.claim_rows?.approved_amount || 0).toLocaleString()}</td>
                <td className="p-2 text-gray-500">{f.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
