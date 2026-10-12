import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith("https://") &&
    !supabaseUrl.includes("your-project") &&
    supabaseAnonKey !== "your-anon-key" &&
    supabaseAnonKey.length > 20,
);

/**
 * Browser/Tauri client uses the anon key only.
 * Never put the service_role key in frontend env vars.
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        storage: window.localStorage,
        storageKey: "seecog-auth",
      },
      global: {
        headers: {
          "x-client-info": "seecog-desktop",
        },
      },
    })
  : null;
