import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = loadEnv(".env");
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const redirects = [
  "http://localhost:1420/",
  "https://tauri.localhost/",
  "http://tauri.localhost/",
  "tauri://localhost/",
  undefined,
];

for (const redirectTo of redirects) {
  const opts = redirectTo ? { redirectTo } : undefined;
  const { error } = await sb.auth.resetPasswordForEmail(
    "sumitkumar302100@gmail.com",
    opts,
  );
  console.log(
    JSON.stringify({
      redirectTo: redirectTo ?? null,
      ok: !error,
      message: error?.message ?? null,
      status: error?.status ?? null,
      len: error?.message?.length ?? 0,
    }),
  );
}
