"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    setSubmitting(false);

    if (signUpError) {
      setError(signUpError.message || "Couldn't create that account.");
      return;
    }

    // Supabase's default setting requires email confirmation before a
    // session exists. If session is present, log straight in; otherwise
    // tell the user to check their inbox rather than silently failing.
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setCheckEmail(true);
    }
  }

  if (checkEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-[340px] border rounded-xl p-6 text-center">
          <p className="font-medium mb-2">Check your email</p>
          <p className="text-sm text-gray-600">
            We sent a confirmation link to {email}. Click it, then come back and sign in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <form onSubmit={handleSubmit} className="w-[340px] border rounded-xl p-6">
        <div className="font-semibold text-lg mb-1">
          AAR Claims <span className="text-aar-orange">QA</span>
        </div>
        <h1 className="text-base font-medium mb-4">Create account</h1>

        <input
          type="text"
          placeholder="Your name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          className="w-full border rounded-full px-4 py-2 mb-3 text-sm"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border rounded-full px-4 py-2 mb-3 text-sm"
        />
        <input
          type="password"
          placeholder="Password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full border rounded-full px-4 py-2 mb-1 text-sm"
        />
        <p className="text-xs text-gray-500 mb-3">
          Minimum 8 characters. The first account created becomes admin automatically.
        </p>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full py-2 bg-aar-orange text-white text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>

        <div className="border-t mt-5 pt-4 text-center">
          <Link href="/login" className="text-sm text-gray-600 hover:text-aar-black">
            Already have an account? Sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
