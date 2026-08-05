import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client — uses the anon key only (safe to expose,
// RLS policies in schema.sql restrict what it can actually do).
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — " +
        "set these in .env.local before running the app."
    );
  }
  return createBrowserClient(url, anonKey);
}
