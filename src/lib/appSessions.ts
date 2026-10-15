import { supabase } from "./supabase";

const ACTIVE_SESSION_KEY = "seecog-app-session-id";

export type AppSessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
};

export async function listEndedAppSessions(
  userId: string,
  limit = 40,
): Promise<AppSessionRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("sessions")
    .select("id, started_at, ended_at")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("Failed to list app sessions:", error.message);
    return [];
  }

  return (data ?? []) as AppSessionRow[];
}

export async function startAppSession(userId: string): Promise<void> {
  if (!supabase) return;

  // Close any open session rows for this user first.
  await supabase
    .from("sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("ended_at", null);

  const { data, error } = await supabase
    .from("sessions")
    .insert({ user_id: userId })
    .select("id")
    .single();

  if (error || !data) {
    console.warn("Failed to start app session:", error?.message);
    return;
  }

  localStorage.setItem(ACTIVE_SESSION_KEY, data.id);
}

export async function endAppSession(): Promise<void> {
  if (!supabase) return;

  const sessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
  localStorage.removeItem(ACTIVE_SESSION_KEY);

  if (!sessionId) return;

  const { error } = await supabase
    .from("sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("ended_at", null);

  if (error) {
    console.warn("Failed to end app session:", error.message);
  }
}
