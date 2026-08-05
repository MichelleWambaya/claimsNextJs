import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { sessionId, fileName, sourceType, sourceRef, totalRowsExpected } = (await req.json()) as {
    sessionId: string;
    fileName: string;
    sourceType?: string;
    sourceRef?: string;
    totalRowsExpected?: number;
  };

  if (!sessionId || !fileName) {
    return NextResponse.json({ error: "Missing sessionId or fileName" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("source_files")
    .insert({
      audit_session_id: sessionId,
      file_name: fileName,
      source_type: sourceType || "manual_upload",
      source_ref: sourceRef || null,
      total_rows_expected: totalRowsExpected || null,
      status: "pending",
    })
    .select("id, file_name, status, row_count")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId query param" }, { status: 400 });

  const { data, error } = await supabase
    .from("source_files")
    .select("id, file_name, source_type, status, row_count, total_rows_expected, schema_issues, created_at")
    .eq("audit_session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
