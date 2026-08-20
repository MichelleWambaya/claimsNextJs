"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { mapHeaders, mapRow } from "@/lib/columnMapping";
import { trimSheetRange } from "@/lib/xlsxUtils";

const CHUNK_SIZE = 2000;

type Status = "idle" | "reading" | "uploading" | "done" | "error";

export default function UploadPanel({ sessionId, onDone }: { sessionId: string; onDone?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setStatus("reading");
    setMessage(null);

    let rows: Record<string, unknown>[] = [];
    try {
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        rows = parseCsv(text);
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        // BUG FIX: previously went straight to wb.Sheets[wb.SheetNames[0]]
        // with no check that a sheet actually exists. A workbook with no
        // sheets (or a first sheet name that isn't really in wb.Sheets)
        // made sheetName/ws undefined, and trimSheetRange's
        // Object.keys(ws) then threw "Cannot convert undefined or null
        // to object" — a confusing native error instead of a clear one.
        if (wb.SheetNames.length === 0) {
          throw new Error("This workbook has no sheets.");
        }
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        // Some export tools leave a sheet's declared "used range" far
        // larger than its actual content (e.g. formatting once applied
        // to a whole row/column makes Excel report the range as
        // extending to row 1,048,576). SheetJS's sheet_to_json walks
        // the ENTIRE declared range cell-by-cell, which can take minutes
        // or effectively freeze the tab even for a file with only a
        // few hundred real rows. Fix: recompute the real bounding box
        // from the cells that actually exist (SheetJS stores them
        // sparsely as object keys) before parsing — this scans in time
        // proportional to real data, not the declared range, regardless
        // of how bloated the file is.
        trimSheetRange(ws);
        rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      }
    } catch (err) {
      setStatus("error");
      setMessage(`Couldn't read that file: ${(err as Error).message}`);
      return;
    }

    if (rows.length === 0) {
      setStatus("error");
      setMessage("No data rows found in that file.");
      return;
    }

    const headers = Object.keys(rows[0]);
    const { mapping, missingRequired } = mapHeaders(headers);
    if (missingRequired.length > 0) {
      setStatus("error");
      setMessage(`Missing required column(s): ${missingRequired.join(", ")}`);
      return;
    }

    const mappedRows = rows.map((r) => mapRow(r, mapping));

    // Create the source_files tracking row first.
    const sfRes = await fetch("/api/source-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fileName: file.name,
        sourceType: "manual_upload",
        totalRowsExpected: mappedRows.length,
      }),
    });
    if (!sfRes.ok) {
      // BUG FIX: previously showed a fixed generic message with no
      // detail at all. Surface the server's actual error when there is
      // one, falling back to the HTTP status rather than
      // sfRes.statusText — statusText is always "" on HTTP/2, which is
      // what Vercel serves in production, so that fallback was
      // frequently blank.
      const body = await sfRes.json().catch(() => ({}));
      setStatus("error");
      setMessage(`Couldn't register this upload: ${body.error || `request failed (HTTP ${sfRes.status})`}`);
      return;
    }
    const sourceFile = await sfRes.json();

    setStatus("uploading");
    setProgress({ sent: 0, total: mappedRows.length });

    // BUG FIX: the failure-path message used to read `progress.sent`
    // from the closure, which still held the value from the render that
    // started this function — `setProgress` calls inside this loop
    // don't update that local binding synchronously, so on failure the
    // message always reported a stale (often 0) count instead of how
    // far the upload actually got. Track sent-so-far in a plain local
    // variable instead and use that for both the message and the state.
    let sentSoFar = 0;

    for (let i = 0; i < mappedRows.length; i += CHUNK_SIZE) {
      const chunk = mappedRows.slice(i, i + CHUNK_SIZE);
      const isFirstChunk = i === 0;
      const isLastChunk = i + CHUNK_SIZE >= mappedRows.length;

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          sourceFileId: sourceFile.id,
          isFirstChunk,
          isLastChunk,
          rows: chunk,
        }),
      });

      if (!res.ok) {
        // BUG FIX: same HTTP/2-statusText issue as above — fall back to
        // the status code, not the (usually empty) statusText.
        const body = await res.json().catch(() => ({}));
        setStatus("error");
        setMessage(
          `Upload failed partway through (${sentSoFar}/${mappedRows.length} rows sent): ${
            body.error || `request failed (HTTP ${res.status})`
          }`
        );
        return;
      }

      sentSoFar = Math.min(i + CHUNK_SIZE, mappedRows.length);
      setProgress({ sent: sentSoFar, total: mappedRows.length });
    }

    setStatus("done");
    setMessage(`Uploaded ${mappedRows.length.toLocaleString()} rows successfully.`);
    onDone?.();
  }

  return (
    <div className="border rounded-xl p-4">
      <div className="font-medium text-sm mb-2">Upload claims file</div>
      <p className="text-xs text-gray-500 mb-3">
        CSV or Excel. Large files are sent in {CHUNK_SIZE.toLocaleString()}-row chunks automatically — hundreds of
        thousands of rows are fine, this just takes a bit longer.
      </p>

      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
        disabled={status === "reading" || status === "uploading"}
        className="text-sm"
      />

      {fileName && <p className="text-xs text-gray-500 mt-2">{fileName}</p>}

      {status === "uploading" && (
        <div className="mt-3">
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-aar-orange h-2 rounded-full transition-all"
              style={{ width: `${progress.total ? (progress.sent / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {progress.sent.toLocaleString()} / {progress.total.toLocaleString()} rows
          </p>
        </div>
      )}

      {message && (
        <p className={`text-sm mt-3 ${status === "error" ? "text-red-600" : "text-green-700"}`}>{message}</p>
      )}
    </div>
  );
}

function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

// Minimal quoted-field CSV split — handles commas inside quotes, which a
// plain .split(",") would break on.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}
