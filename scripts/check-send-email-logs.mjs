/**
 * Fetch recent Edge Function logs for send-email (Management API).
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
public class SbTokLogs {
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
$token = [SbTokLogs]::Get('Supabase CLI:supabase')
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
  console.error(JSON.stringify({ ok: false, message: "No token" }));
  process.exit(1);
}

const ref = "kjuywrbscqihdyfchrhr";
const slug = "send-email";

// Analytics / logs API variants
const urls = [
  `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?iso_timestamp_start=${encodeURIComponent(new Date(Date.now() - 30 * 60 * 1000).toISOString())}&iso_timestamp_end=${encodeURIComponent(new Date().toISOString())}&sql=${encodeURIComponent(`select timestamp, event_message from function_logs where function_id = '${slug}' order by timestamp desc limit 30`)}`,
  `https://api.supabase.com/v1/projects/${ref}/functions/${slug}`,
];

for (const url of urls) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  console.log("---", res.status, url.slice(0, 90));
  console.log(text.slice(0, 2500));
}
