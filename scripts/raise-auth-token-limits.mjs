/**
 * Raise Auth OTP / recovery request cooldowns (hosted "for security purposes… after N seconds").
 * Uses SUPABASE_ACCESS_TOKEN or the Windows "Supabase CLI:supabase" credential.
 */
import { execFileSync } from "node:child_process";

function readCliToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    return process.env.SUPABASE_ACCESS_TOKEN.trim();
  }

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class SbTokLimits {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ReadCred(string target, int type, int flags, out IntPtr cred);
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
    if (!ReadCred(target, 1, 0, out p)) return "";
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    if (c.CredentialBlobSize <= 0 || c.CredentialBlob == IntPtr.Zero) { CredFree(p); return ""; }
    byte[] bytes = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, bytes, 0, c.CredentialBlobSize);
    CredFree(p);
    string s = Encoding.UTF8.GetString(bytes).Trim('\\0').Trim();
    if (s.IndexOf("sbp_") >= 0 || s.IndexOf("eyJ") >= 0) return s;
    s = Encoding.Unicode.GetString(bytes).Trim('\\0').Trim();
    return s;
  }
}
"@
$token = [SbTokLimits]::Get('Supabase CLI:supabase')
-join ($token.ToCharArray() | Where-Object { [int]$_ -ge 32 -and [int]$_ -le 126 })
`;

  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", ps],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

const token = readCliToken();
if (!token) {
  console.error(JSON.stringify({ ok: false, message: "No Supabase access token" }));
  process.exit(1);
}

const ref = "kjuywrbscqihdyfchrhr";

// First GET current config keys related to rate limits
const getRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
});
const current = await getRes.json();
const rateKeys = Object.fromEntries(
  Object.entries(current).filter(
    ([k]) =>
      k.includes("rate") ||
      k.includes("otp") ||
      k.includes("token") ||
      k.includes("mailer") ||
      k.includes("email"),
  ),
);
console.log("current_rate_related:", JSON.stringify(rateKeys, null, 2));

const body = {
  // Hourly email send cap (already raised elsewhere)
  rate_limit_email_sent: 1_000_000,
  // Token / OTP / magic-link style request caps (per hour where applicable)
  rate_limit_otp: 1_000_000,
  rate_limit_token_refresh: 1_000_000,
  rate_limit_verify: 1_000_000,
};

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
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
    JSON.stringify({
      ok: false,
      status: res.status,
      message: json.message || json.msg || text.slice(0, 400),
    }),
  );
  process.exit(2);
}

const after = Object.fromEntries(
  Object.entries(json).filter(
    ([k]) =>
      k.includes("rate") ||
      k.includes("otp") ||
      k.includes("token") ||
      k.includes("mailer") ||
      k.includes("email"),
  ),
);
console.log(JSON.stringify({ ok: true, after }, null, 2));
