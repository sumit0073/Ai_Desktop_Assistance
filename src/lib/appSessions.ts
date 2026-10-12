import { supabase } from "./supabase";

const ACTIVE_SESSION_KEY = "seecog-app-session-id";

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
