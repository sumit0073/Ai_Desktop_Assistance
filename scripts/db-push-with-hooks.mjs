import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function loadEnv(path) {
  if (!existsSync(path)) return {};
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

const envFile = loadEnv(".env");
const placeholder =
  `v1,whsec_${Buffer.from("local-dev-hook-secret-min-32-bytes!!").toString("base64")}`;

const childEnv = {
  ...process.env,
  SEND_SMS_HOOK_SECRETS: envFile.SEND_SMS_HOOK_SECRETS || placeholder,
  SEND_EMAIL_HOOK_SECRETS: envFile.SEND_EMAIL_HOOK_SECRETS || placeholder,
};

console.log("Pushing DB migrations…");
const result = spawnSync(
  "npx",
  ["--yes", "supabase", "db", "push", "--yes"],
  { env: childEnv, stdio: "inherit", shell: true },
);
process.exit(result.status ?? 1);
