import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

// Manual-batch upload endpoint (per the decision to skip a job queue).
//
// The CLIENT is responsible for splitting a large file into chunks
// (e.g. 2,000 rows each — see components/dashboard/UploadPanel.tsx) and
// calling this endpoint once per chunk. Each call only does one bounded
// insert, so it always finishes well within Vercel's serverless function
// time limit (10s on Hobby, 60s on Pro) regardless of total file size —
// a 300,000-row file just becomes ~150 sequential calls instead of one
// call that would time out.
//
// Body shape:
// {
//   sessionId: string,
//   sourceFileId: string,       // created by the client on the first chunk via /api/source-files
//   isFirstChunk: boolean,
//   isLastChunk: boolean,
//   rows: Array<Record<string, any>>  // already column-mapped by the client
// }
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { sessionId, sourceFileId, isLastChunk, rows } = body as {
    sessionId: string;
    sourceFileId: string;
    isFirstChunk: boolean;
    isLastChunk: boolean;
    rows: Record<string, unknown>[];
  };

  if (!sessionId || !sourceFileId || !Array.isArray(rows)) {
    return NextResponse.json({ error: "Missing sessionId, sourceFileId, or rows" }, { status: 400 });
  }
  if (rows.length > 5000) {
    // Bounds a single request's memory/time even if the client sends an
    // oversized chunk by mistake — keeps every call cheap and predictable.
    return NextResponse.json({ error: "Chunk too large — send at most 5000 rows per call" }, { status: 413 });
  }

  // Service-role client for the actual insert: batch inserts of
  // thousands of rows should not be gated by RLS policy evaluation on
  // every row, and this endpoint already authenticated the user above.
  const admin = createServiceRoleClient();

  const insertRows = rows.map((r) => ({
    audit_session_id: sessionId,
    source_file_id: sourceFileId,
    member_id: r.member_id ?? null,
    policy_number: r.policy_number ?? null,
    claim_code: r.claim_code ?? null,
    claim_status: r.claim_status ?? null,
    provider: r.provider ?? null,
    provider_affiliation: r.provider_affiliation ?? null,
    category: r.category ?? null,
    diagnosis_type: r.diagnosis_type ?? null,
    diagnosis_name: r.diagnosis_name ?? null,
    invoice_number: r.invoice_number ?? null,
    product_name: r.product_name ?? null,
    visit_date: r.visit_date ?? null,
    amount: r.amount ?? null,
    approved_amount: r.approved_amount ?? null,
    denial_code: r.denial_code ?? null,
    raw: r,
  }));

  const { error: insertError } = await admin.from("claim_rows").insert(insertRows);
  if (insertError) {
    await admin
      .from("source_files")
      .update({ status: "error", schema_issues: [{ kind: "insert_error", detail: insertError.message }] })
      .eq("id", sourceFileId);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Live progress: bump row_count by this chunk's size so a polling
  // client can show "N rows processed so far" without waiting for the
  // whole file to finish.
  const { data: currentFile } = await admin
    .from("source_files")
    .select("row_count")
    .eq("id", sourceFileId)
    .single();
  const newCount = (currentFile?.row_count ?? 0) + rows.length;

  await admin
    .from("source_files")
    .update({
      row_count: newCount,
      status: isLastChunk ? "merged" : "parsing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sourceFileId);

  return NextResponse.json({ inserted: rows.length, totalSoFar: newCount, done: !!isLastChunk });
}
