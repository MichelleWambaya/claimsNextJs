import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { listFolder, downloadFile, refreshAccessToken } from "@/lib/msGraph";
import { mapHeaders, mapRow } from "@/lib/columnMapping";
import { trimSheetRange } from "@/lib/xlsxUtils";

const INSERT_BATCH = 2000;

async function getValidAccessToken(userId: string) {
  const admin = createServiceRoleClient();
  const { data: token } = await admin.from("ms_oauth_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!token) {
    throw Object.assign(new Error("Microsoft account not connected. Connect it first."), { status: 409 });
  }
  if (new Date(token.expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    const expiresAt = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
    await admin
      .from("ms_oauth_tokens")
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || token.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return refreshed.access_token as string;
  }
  return token.access_token as string;
}

// GET: list a folder's contents (so the UI can show file names to pick from).
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const folderPath = req.nextUrl.searchParams.get("folderPath") || "";
  try {
    const accessToken = await getValidAccessToken(authData.user.id);
    const items = await listFolder(accessToken, folderPath);
    return NextResponse.json(
      items
        .filter((i) => i.file)
        .map((i) => ({ id: i.id, name: i.name, size: i.size, downloadUrl: i["@microsoft.graph.downloadUrl"] }))
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}

// POST: fetch a specific file by its Graph download URL and ingest it.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { sessionId, fileName, downloadUrl } = (await req.json()) as {
    sessionId: string;
    fileName: string;
    downloadUrl: string;
  };
  if (!sessionId || !fileName || !downloadUrl) {
    return NextResponse.json({ error: "Missing sessionId, fileName, or downloadUrl" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: sourceFile, error: sfError } = await admin
    .from("source_files")
    .insert({ audit_session_id: sessionId, file_name: fileName, source_type: "ms_oauth_sync", status: "parsing" })
    .select()
    .single();
  if (sfError) return NextResponse.json({ error: sfError.message }, { status: 500 });

  try {
    const buf = await downloadFile(downloadUrl);
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    trimSheetRange(ws); // see lib/xlsxUtils.ts for why — bloated-declared-range fix, server-side
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (rows.length === 0) {
      await admin.from("source_files").update({ status: "error", schema_issues: [{ kind: "empty_file" }] }).eq("id", sourceFile.id);
      return NextResponse.json({ error: "No data rows found in that file." }, { status: 422 });
    }

    const headers = Object.keys(rows[0]);
    const { mapping, missingRequired } = mapHeaders(headers);
    if (missingRequired.length > 0) {
      await admin
        .from("source_files")
        .update({ status: "error", schema_issues: [{ kind: "missing_column", detail: missingRequired.join(", ") }] })
        .eq("id", sourceFile.id);
      return NextResponse.json({ error: `Missing required column(s): ${missingRequired.join(", ")}` }, { status: 422 });
    }

    const mappedRows = rows.map((r) => mapRow(r, mapping));

    for (let i = 0; i < mappedRows.length; i += INSERT_BATCH) {
      const chunk = mappedRows.slice(i, i + INSERT_BATCH).map((r: any) => ({
        audit_session_id: sessionId,
        source_file_id: sourceFile.id,
        member_id: r.member_id ?? null,
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
      const { error: insertError } = await admin.from("claim_rows").insert(chunk);
      if (insertError) {
        await admin.from("source_files").update({ status: "error" }).eq("id", sourceFile.id);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    await admin.from("source_files").update({ status: "merged", row_count: mappedRows.length }).eq("id", sourceFile.id);
    return NextResponse.json({ rowsIngested: mappedRows.length });
  } catch (err: any) {
    await admin.from("source_files").update({ status: "error" }).eq("id", sourceFile.id);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
