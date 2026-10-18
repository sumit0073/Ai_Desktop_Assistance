/**
 * Delete an Auth user by email (Admin API). Usage:
 *   node scripts/delete-auth-user.mjs sumitkumar302100@gmail.com
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
public class SbTokDel {
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
$token = [SbTokDel]::Get('Supabase CLI:supabase')
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

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error(JSON.stringify({ ok: false, message: "Usage: node scripts/delete-auth-user.mjs <email>" }));
  process.exit(1);
}

const token = readCliToken();
if (!token) {
  console.error(JSON.stringify({ ok: false, message: "No Supabase access token" }));
  process.exit(1);
}

const ref = "kjuywrbscqihdyfchrhr";
const api = "https://api.supabase.com/v1";

const keysRes = await fetch(`${api}/projects/${ref}/api-keys`, {
  headers: { Authorization: `Bearer ${token}` },
});
const keys = await keysRes.json();
if (!keysRes.ok) {
  console.error(JSON.stringify({ ok: false, status: keysRes.status, message: keys.message || keys }));
  process.exit(2);
}

const serviceKey = Array.isArray(keys)
  ? keys.find((k) => k.name === "service_role" || k.tags?.includes("service_role"))?.api_key
  : null;

if (!serviceKey) {
  console.error(JSON.stringify({ ok: false, message: "service_role key not found" }));
  process.exit(2);
}

const projectUrl = `https://${ref}.supabase.co`;

// List users and find by email (paginate a bit).
let userId = null;
for (let page = 1; page <= 20 && !userId; page++) {
  const listRes = await fetch(
    `${projectUrl}/auth/v1/admin/users?page=${page}&per_page=200`,
    {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    },
  );
  const listJson = await listRes.json();
  if (!listRes.ok) {
    console.error(
      JSON.stringify({
        ok: false,
        status: listRes.status,
        message: listJson.msg || listJson.message || listJson,
      }),
    );
    process.exit(2);
  }
  const users = listJson.users || listJson;
  if (!Array.isArray(users) || users.length === 0) break;
  const match = users.find((u) => (u.email || "").toLowerCase() === email);
  if (match) userId = match.id;
  if (users.length < 200) break;
}

if (!userId) {
  console.log(JSON.stringify({ ok: true, deleted: false, email, message: "No Auth user with that email" }));
  process.exit(0);
}

const delRes = await fetch(`${projectUrl}/auth/v1/admin/users/${userId}`, {
  method: "DELETE",
  headers: {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  },
});

if (!delRes.ok) {
  const text = await delRes.text();
  console.error(JSON.stringify({ ok: false, status: delRes.status, message: text.slice(0, 400) }));
  process.exit(2);
}

console.log(JSON.stringify({ ok: true, deleted: true, email, userId }));
