import type { User } from "@supabase/supabase-js";

/** True when Auth has confirmed the user's email (signup OTP / confirm flow). */
export function isEmailVerified(user: User | null | undefined): boolean {
  if (!user?.email) return false;
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}
