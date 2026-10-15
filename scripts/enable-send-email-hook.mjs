/**
 * Enable hosted Auth Send Email hook (SES) via Management API.
 * Stops Supabase built-in mailer from sending recovery/OTP emails.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

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

function readWindowsCredential(target) {
  // PowerShell CredRead without naming collision
  const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SbCred {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  public static string Get(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return "";
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    string pass = c.CredentialBlobSize > 0
      ? Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2)
      : "";
    CredFree(p);
    return pass ?? "";
  }
}
"@
[SbCred]::Get('${target.replace(/'/g, "''")}')
`;
  try {
    return execSync(`powershell -NoProfile -Command ${JSON.stringify(ps)}`, {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

const env = loadEnv(".env");
const emailSecret = env.SEND_EMAIL_HOOK_SECRETS;
if (!emailSecret) {
  console.error("Missing SEND_EMAIL_HOOK_SECRETS in .env");
  process.exit(1);
}

const token =
  process.env.SUPABASE_ACCESS_TOKEN?.trim() ||
  readWindowsCredential("Supabase CLI:supabase");

if (!token) {
  console.error(
    "No Supabase access token. Run `npx supabase login`, then retry.",
  );
  process.exit(1);
}

const ref = "kjuywrbscqihdyfchrhr";
const uri = `https://${ref}.supabase.co/functions/v1/send-email`;

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    hook_send_email_enabled: true,
    hook_send_email_uri: uri,
    hook_send_email_secrets: emailSecret,
  }),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text };
}

if (!res.ok) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: res.status,
        message: json.message || json.msg || text.slice(0, 500),
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      hook_send_email_enabled: json.hook_send_email_enabled,
      hook_send_email_uri: json.hook_send_email_uri,
      site_url: json.site_url,
      note: "Supabase built-in mailer is replaced by send-email → SES when hook is enabled",
    },
    null,
    2,
  ),
);
