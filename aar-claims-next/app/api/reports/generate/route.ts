import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const PAGE_SIZE = 1000;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { sessionId, categoryFilter, rangeFrom, rangeTo } = (await req.json()) as {
    sessionId: string;
    categoryFilter?: string;
    rangeFrom?: string;
    rangeTo?: string;
  };
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

  const admin = createServiceRoleClient();

  // BUG FIX: this used to be a single unbounded .select(), which
  // PostgREST silently caps at 1000 rows. Any session with more than
  // 1000 flags (easily the case per the app's own "hundreds of
  // thousands of rows" design goal) produced a report with an
  // undercounted totalFlags/totalAmount. Paginate the same way
  // /api/flags/recompute already does for claim_rows.
  const flagRows: any[] = [];
  let from = 0;
  while (true) {
    let query = admin
      .from("flags")
      .select("flag_type, claim_rows(approved_amount, visit_date)")
      .eq("audit_session_id", sessionId)
      .range(from, from + PAGE_SIZE - 1);
    if (categoryFilter) query = query.eq("flag_type", categoryFilter);

    const { data: page, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!page || page.length === 0) break;
    flagRows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const inRange = flagRows.filter((f: any) => {
    const d = f.claim_rows?.visit_date;
    if (!d) return false;
    if (rangeFrom && d < rangeFrom) return false;
    if (rangeTo && d > rangeTo) return false;
    return true;
  });

  const counts: Record<string, number> = {};
  let totalAmount = 0;
  for (const f of inRange as any[]) {
    counts[f.flag_type] = (counts[f.flag_type] || 0) + 1;
    totalAmount += Number(f.claim_rows?.approved_amount || 0);
  }

  const { data: report, error: insertError } = await admin
    .from("generated_reports")
    .insert({
      audit_session_id: sessionId,
      generated_by: authData.user.id,
      report_type: "presentation",
      category_filter: categoryFilter || null,
      range_from: rangeFrom || null,
      range_to: rangeTo || null,
      summary: { counts, totalAmount, totalFlags: inRange.length },
      status: "ready",
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json(report);
}
