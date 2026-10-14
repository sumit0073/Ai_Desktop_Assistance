/**
 * Supabase Auth "Send SMS" hook → BlackSMS (same provider as OpsPick / MiniTaskManager).
 *
 * Auth generates the OTP; this function only delivers it.
 * Deploy with JWT verification disabled (hook uses Standard Webhooks instead).
 *
 * Secrets:
 * - SEND_SMS_HOOK_SECRETS  (v1,whsec_...)
 * - BLACKSMS_API_KEY
 * - BLACKSMS_SENDER_ID
 * - BLACKSMS_ROUTE (optional, default "1")
 * - BLACKSMS_SMS_URL (optional, default https://blacksms.in/sms)
 */
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type HookPayload = {
  user: { phone?: string | null };
  sms: { otp?: string };
};

type BlackSmsResponse = {
  return?: boolean;
  request_id?: string;
  status?: number;
  message?: string | string[];
};

function toIndiaLocalNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return null;
}

function hookError(status: number, message: string, retryable = false): Response {
  return new Response(
    JSON.stringify({
      error: {
        http_code: status,
        message,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...(retryable ? { "retry-after": "true" } : {}),
      },
    },
  );
}

async function sendViaBlacksms(phone: string, otp: string): Promise<void> {
  const apiKey = Deno.env.get("BLACKSMS_API_KEY")?.trim();
  const senderId = Deno.env.get("BLACKSMS_SENDER_ID")?.trim();
  const route = Deno.env.get("BLACKSMS_ROUTE")?.trim() || "1";
  const smsUrl = Deno.env.get("BLACKSMS_SMS_URL")?.trim() || "https://blacksms.in/sms";

  if (!apiKey || !senderId) {
    throw new Error("BlackSMS is not configured (BLACKSMS_API_KEY / BLACKSMS_SENDER_ID).");
  }

  const numbers = toIndiaLocalNumber(phone);
  if (!numbers) {
    throw new Error("BlackSMS requires a valid Indian mobile number (+91XXXXXXXXXX).");
  }

  if (!/^\d{4,8}$/.test(otp)) {
    throw new Error("Invalid OTP payload from Auth.");
  }

  const res = await fetch(smsUrl, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_id: senderId,
      route,
      variables_values: otp,
      numbers,
    }),
  });

  const bodyText = await res.text();
  let body: BlackSmsResponse = {};
  try {
    body = bodyText ? (JSON.parse(bodyText) as BlackSmsResponse) : {};
  } catch {
    body = { message: bodyText };
  }

  const messageText = Array.isArray(body.message)
    ? body.message.join(", ")
    : body.message || `BlackSMS HTTP ${res.status}`;

  const ok = res.ok && (body.return === true || body.status === 1);
  if (!ok) {
    throw new Error(messageText);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return hookError(400, "POST required");
  }

  const hookSecrets = Deno.env.get("SEND_SMS_HOOK_SECRETS")?.trim();
  if (!hookSecrets) {
    return hookError(500, "SEND_SMS_HOOK_SECRETS is not configured");
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const secret = hookSecrets.replace("v1,whsec_", "");

  try {
    const wh = new Webhook(secret);
    const event = wh.verify(payload, headers) as HookPayload;
    const phone = event.user?.phone?.trim();
    const otp = event.sms?.otp?.trim();

    if (!phone || !otp) {
      return hookError(400, "Missing phone or OTP in hook payload");
    }

    await sendViaBlacksms(phone, otp);

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-sms hook failed:", message);

    // Signature / parse failures → 400; provider failures → retryable 503
    const retryable =
      message.includes("BlackSMS") ||
      message.includes("fetch") ||
      message.includes("network");

    return hookError(retryable ? 503 : 400, `Failed to send SMS: ${message}`, retryable);
  }
});
