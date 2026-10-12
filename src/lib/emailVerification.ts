import type { User } from "@supabase/supabase-js";

/** Demo accounts and confirmed users may start sessions. */
export function isEmailVerified(user: User | null, demoMode = false): boolean {
  if (!user) return false;
  if (demoMode || user.id === "demo-user") return true;
  return Boolean(user.email_confirmed_at);
}
