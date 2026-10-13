/**
 * Opt-in live integration tests against deployed chat-proxy / stt-proxy.
 *
 * Ordinary `npm test` excludes this file (see vitest.config.ts).
 * Run only via: `npm run test:live`
 *
 * Required env (values never logged by this suite):
 *   SEECOG_LIVE_PROXY_TESTS=1
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   VITE_CHAT_PROXY_URL
 *   VITE_STT_PROXY_URL
 *   LIVE_TEST_EMAIL
 *   LIVE_TEST_PASSWORD
 *
 * Use a dedicated Supabase Auth test user. Small synthetic tone WAV only —
 * never a real meeting recording.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";

const LIVE_ENV_KEYS = [
  "SEECOG_LIVE_PROXY_TESTS",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_CHAT_PROXY_URL",
  "VITE_STT_PROXY_URL",
  "LIVE_TEST_EMAIL",
  "LIVE_TEST_PASSWORD",
] as const;

const enabled = process.env.SEECOG_LIVE_PROXY_TESTS === "1";

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
const chatProxyUrl = process.env.VITE_CHAT_PROXY_URL?.trim() ?? "";
const sttProxyUrl = process.env.VITE_STT_PROXY_URL?.trim() ?? "";
const email = process.env.LIVE_TEST_EMAIL?.trim() ?? "";
const password = process.env.LIVE_TEST_PASSWORD?.trim() ?? "";

/** Names only — never include values (avoids leaking secrets in test output). */
function missingLiveEnvNames(): string[] {
  const missing: string[] = [];
  if (!enabled) missing.push("SEECOG_LIVE_PROXY_TESTS");
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!chatProxyUrl) missing.push("VITE_CHAT_PROXY_URL");
  if (!sttProxyUrl) missing.push("VITE_STT_PROXY_URL");
  if (!email) missing.push("LIVE_TEST_EMAIL");
  if (!password) missing.push("LIVE_TEST_PASSWORD");
  return missing;
}

const missingNames = missingLiveEnvNames();
const canRun = missingNames.length === 0;

function assertNoSecretLeak(body: string, headers: Headers): void {
  expect(body).not.toMatch(/\bgsk_[A-Za-z0-9]{10,}\b/);
  expect(body.toLowerCase()).not.toContain("groq_api_key");
  expect(body).not.toMatch(/Bearer\s+gsk_/i);
  for (const name of ["authorization", "x-api-key", "x-groq"]) {
    const v = headers.get(name);
    if (v) expect(v).not.toMatch(/\bgsk_/i);
  }
}

/** Tiny mono 16 kHz 16-bit WAV with a short tone (not a meeting recording). */
function buildTinyToneWav(): Blob {
  const sampleRate = 16_000;
  const numSamples = Math.floor(sampleRate * 0.25);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * t) * 0.2;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function extractSseText(body: string): string {
  let full = "";
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string | null } }>;
      };
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === "string") full += delta;
    } catch {
      // ignore partial frames
    }
  }
  return full;
}

async function signInTestUser(): Promise<{
  supabase: SupabaseClient;
  accessToken: string;
}> {
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  // Avoid printing error objects that might echo emails; assert status only.
  expect(error, "sign-in failed for LIVE_TEST_EMAIL (check dedicated test user)").toBeNull();
  const accessToken = data.session?.access_token;
  expect(accessToken, "missing access_token after sign-in").toBeTruthy();
  return { supabase, accessToken: accessToken! };
}

/**
 * When credentials are absent, Vitest shows this suite as passed with an
 * explanatory case — that means NOT TESTED, not a successful live integration.
 */
describe.skipIf(canRun)(
  "live proxy integration (not configured — skipped)",
  () => {
    it("lists missing env var NAMES only (no secret values)", () => {
      expect(canRun).toBe(false);
      expect(missingNames.length).toBeGreaterThan(0);
      for (const name of missingNames) {
        expect(LIVE_ENV_KEYS).toContain(name as (typeof LIVE_ENV_KEYS)[number]);
        // Guard: names must not look like secret material.
        expect(name).not.toMatch(/gsk_|eyJ|Bearer/i);
      }
    });
  },
);

/**
 * Runs only when every required env var is present.
 * A green run here is the evidence for Live authenticated proxy tests = PASS.
 */
describe.skipIf(!canRun)("live proxy integration (authenticated)", () => {
  const clients: SupabaseClient[] = [];

  afterAll(async () => {
    for (const c of clients) {
      try {
        await c.auth.signOut();
      } catch {
        /* ignore */
      }
    }
  });

  it("rejects chat-proxy without Authorization (4xx, no secret leak)", async () => {
    const res = await fetch(chatProxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: "ping" }],
        stream: true,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
    const text = await res.text();
    assertNoSecretLeak(text, res.headers);
  });

  it("rejects stt-proxy with an invalid bearer token (4xx, no secret leak)", async () => {
    const form = new FormData();
    form.append("file", buildTinyToneWav(), "tone.wav");
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "en");

    const res = await fetch(sttProxyUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer eyJhbGciOiJub25lIn0.invalid.token",
        apikey: anonKey,
      },
      body: form,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
    const text = await res.text();
    assertNoSecretLeak(text, res.headers);
  });

  it("streams chat for a signed-in user without leaking secrets", async () => {
    const { supabase, accessToken } = await signInTestUser();
    clients.push(supabase);

    const res = await fetch(chatProxyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "user",
            content: "Reply with exactly the word ok and nothing else.",
          },
        ],
        temperature: 0,
        stream: true,
      }),
    });

    expect(res.ok, `unexpected chat HTTP status ${res.status}`).toBe(true);
    expect(res.headers.get("content-type") ?? "").toMatch(
      /text\/event-stream/i,
    );

    const body = await res.text();
    assertNoSecretLeak(body, res.headers);
    expect(body.includes("data:")).toBe(true);
    const streamed = extractSseText(body);
    expect(streamed.trim().length).toBeGreaterThan(0);
  }, 90_000);

  it("returns structured STT JSON for a signed-in user", async () => {
    const { supabase, accessToken } = await signInTestUser();
    clients.push(supabase);

    const form = new FormData();
    form.append("file", buildTinyToneWav(), "tone.wav");
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "en");
    form.append("prompt", "");

    const res = await fetch(sttProxyUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: form,
    });

    const text = await res.text();
    assertNoSecretLeak(text, res.headers);

    // Tone may yield empty transcript; require safe JSON shape either way.
    expect([200, 400, 413, 415, 429, 502, 504]).toContain(res.status);
    const parsed = JSON.parse(text) as {
      text?: unknown;
      message?: unknown;
      requestId?: unknown;
    };
    expect(typeof parsed.requestId).toBe("string");
    if (res.status === 200) {
      expect(typeof parsed.text).toBe("string");
    } else {
      expect(typeof parsed.message).toBe("string");
    }
  }, 90_000);

  it("keeps burst responses safe (in-memory rate limit is best-effort only)", async () => {
    // Does NOT prove globally consistent rate limiting across Edge isolates.
    const { supabase, accessToken } = await signInTestUser();
    clients.push(supabase);

    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await fetch(chatProxyUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [{ role: "user", content: "ping" }],
          stream: true,
        }),
      });
      statuses.push(res.status);
      const body = await res.text();
      assertNoSecretLeak(body, res.headers);
    }

    expect(
      statuses.every(
        (s) => s === 200 || s === 429 || s === 400 || s === 502 || s === 504,
      ),
    ).toBe(true);
  }, 120_000);
});
