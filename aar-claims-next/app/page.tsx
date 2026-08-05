import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Same reasoning as the other dynamic pages — this reads the user's
// session via cookies, which only exists per-request, not at build time.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  redirect(data.user ? "/dashboard" : "/login");
}
