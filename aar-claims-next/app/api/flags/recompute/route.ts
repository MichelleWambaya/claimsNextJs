import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { runAllRules, DEFAULT_RULE_CONFIG, type ClaimRow } from "@/lib/rules";

const PAGE_SIZE = 1000;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId, rangeFrom, rangeTo } = (await req.json()) as {
    sessionId: string;
    rangeFrom?: string;
    rangeTo?: string;
  };
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Load the session's rule config (admin-editable thresholds), falling
  // back to defaults if none has been saved yet.
  const { data: configRow } = await admin
    .from("rule_config")
    .select("config")
    .eq("audit_session_id", sessionId)
    .maybeSingle();
  const config = configRow?.config ?? DEFAULT_RULE_CONFIG;

  // Paginate through claim_rows rather than one unbounded SELECT — this
  // is what makes hundreds of thousands of rows safe to process here.
  const allRows: ClaimRow[] = [];
  let from = 0;
  while (true) {
    let query = admin
      .from("claim_rows")
      .select("id, member_id, claim_status, provider, category, diagnosis_type, diagnosis_name, product_name, visit_date, amount, approved_amount, denial_code")
      .eq("audit_session_id", sessionId)
      .range(from, from + PAGE_SIZE - 1);
    if (rangeFrom) query = query.gte("visit_date", rangeFrom);
    if (rangeTo) query = query.lte("visit_date", rangeTo);

    const { data: page, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!page || page.length === 0) break;
    allRows.push(...(page as ClaimRow[]));
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const flags = runAllRules(allRows, config);

  // Replace this session's flags atomically-ish: delete then bulk insert
  // in chunks (Supabase/Postgrest has a practical payload size limit per
  // request, so large flag sets are inserted in batches too).
  await admin.from("flags").delete().eq("audit_session_id", sessionId);

  const FLAG_INSERT_BATCH = 2000;
  for (let i = 0; i < flags.length; i += FLAG_INSERT_BATCH) {
    const batch = flags.slice(i, i + FLAG_INSERT_BATCH).map((f) => ({
      audit_session_id: sessionId,
      claim_row_id: f.claim_row_id,
      flag_type: f.flag_type,
      group_id: f.group_id ?? null,
      reason: f.reason,
      detail: f.detail,
    }));
    const { error: insertError } = await admin.from("flags").insert(batch);
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ rowsProcessed: allRows.length, flagsComputed: flags.length });
}
