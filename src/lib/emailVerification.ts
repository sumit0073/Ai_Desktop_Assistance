import type { User } from "@supabase/supabase-js";

/**
 * Email confirmation is disabled for System Bunny — any signed-in user may start sessions.
 * Kept for compatibility with older imports/tests.
 */
export function isEmailVerified(user: User | null): boolean {
  return Boolean(user);
}
