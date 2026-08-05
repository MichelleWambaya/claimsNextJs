import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { exchangeCodeForToken } from "@/lib/msGraph";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state from Microsoft redirect" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: stateRow, error: stateError } = await admin
    .from("ms_oauth_states")
    .select("user_id")
    .eq("state", state)
    .maybeSingle();

  if (stateError || !stateRow) {
    return NextResponse.json({ error: "Invalid or expired OAuth state — please try connecting again." }, { status: 400 });
  }
  await admin.from("ms_oauth_states").delete().eq("state", state);

  let tokenResponse;
  try {
    tokenResponse = await exchangeCodeForToken(code);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const expiresAt = new Date(Date.now() + (tokenResponse.expires_in || 3600) * 1000).toISOString();

  await admin.from("ms_oauth_tokens").upsert({
    user_id: stateRow.user_id,
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: expiresAt,
    scope: tokenResponse.scope,
    updated_at: new Date().toISOString(),
  });

  const redirectUrl = new URL("/dashboard?ms_connected=1", req.url);
  return NextResponse.redirect(redirectUrl);
}
