/**
 * Set Auth email rate limit as high as practical (hosted Auth cannot fully disable it).
 * Uses SUPABASE_ACCESS_TOKEN, or the Windows "Supabase CLI:supabase" credential.
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
public class SbTok2 {
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
    // Prefer UTF-8; fall back to Unicode if needed
    string s = Encoding.UTF8.GetString(bytes).Trim('\\0').Trim();
    if (s.IndexOf("sbp_") >= 0 || s.IndexOf("eyJ") >= 0) return s;
    s = Encoding.Unicode.GetString(bytes).Trim('\\0').Trim();
    return s;
  }
}
"@
$token = [SbTok2]::Get('Supabase CLI:supabase')
# Keep ASCII only (JWT / sbp_ tokens)
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
  console.error(
    JSON.stringify({
      ok: false,
      message:
        "No Supabase access token. In Dashboard: Authentication → Rate Limits → Email → set a very high value. Or set SUPABASE_ACCESS_TOKEN.",
    }),
  );
  process.exit(1);
}

const ref = "kjuywrbscqihdyfchrhr";
// Hosted Auth always has a numeric hourly cap; use a very high value (= effectively off).
const limit = Number(process.env.EMAIL_RATE_LIMIT || 1_000_000);

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    rate_limit_email_sent: limit,
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
    JSON.stringify({
      ok: false,
      status: res.status,
      message: json.message || json.msg || text.slice(0, 400),
    }),
  );
  process.exit(2);
}

console.log(
  JSON.stringify({
    ok: true,
    rate_limit_email_sent: json.rate_limit_email_sent ?? limit,
  }),
);
