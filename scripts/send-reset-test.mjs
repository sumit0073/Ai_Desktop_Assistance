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
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
const email = "sumitkumar302100@gmail.com";
const redirectTo =
  env.VITE_AUTH_REDIRECT_URL?.trim() || "https://kjuywrbscqihdyfchrhr.supabase.co";

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

if (error) {
  console.log(JSON.stringify({ ok: false, message: error.message, status: error.status ?? null }));
  process.exit(2);
}

console.log(
  JSON.stringify({
    ok: true,
    email,
    note: "resetPasswordForEmail accepted — check inbox/spam for SES reset mail",
  }),
);
