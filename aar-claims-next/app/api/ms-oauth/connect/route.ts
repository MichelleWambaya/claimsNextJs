import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl, isMsOAuthConfigured } from "@/lib/msGraph";
import { randomUUID } from "crypto";

export async function GET() {
  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isMsOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Delegated Microsoft sign-in isn't configured on this deployment " +
          "(missing MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_OAUTH_REDIRECT_URI).",
      },
      { status: 503 }
    );
  }

  // State carries the user id via a short-lived row rather than a signed
  // JWT — simpler here since Supabase is already the source of truth,
  // and its own RLS policy on ms_oauth_states restricts this insert to
  // the authenticated user's own row.
  const state = randomUUID();
  await supabase.from("ms_oauth_states").upsert({ state, user_id: authData.user.id, created_at: new Date().toISOString() });


  return NextResponse.json({ authorizeUrl: buildAuthorizeUrl(state) });
}
