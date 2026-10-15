/**
 * Supabase Auth "Send Email" hook → Amazon SES SMTP
 * (same SMTP_* keys as Mini Task Manager / OpsPick).
 *
 * Replaces Supabase’s built-in mailer when this hook is enabled.
 * Auth creates OTP / recovery tokens; this function delivers via SES.
 *
 * Edge note: Deno Deploy blocks SMTP 25/587 — SES alternate port **2587** is used.
 * Auth hooks time out at ~5s, so send runs via EdgeRuntime.waitUntil after a fast 200.
 *
 * Secrets: SEND_EMAIL_HOOK_SECRETS, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * SMTP_FROM, AWS_SES_REGION (optional), AUTH_REDIRECT_URL (optional)
 */
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
// nodemailer is loaded inside waitUntil (dynamic import) so Auth's ~5s hook
// budget isn't blown by cold-start npm resolution.

type EmailActionType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email"
  | string;

type HookPayload = {
  user: { email?: string | null };
  email_data: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: EmailActionType;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

// Supabase Edge Functions runtime helper (background work after response).
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

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

function resolveSmtpHost(): string {
  const explicit = Deno.env.get("SMTP_HOST")?.trim();
  if (explicit) return explicit;
  const region = Deno.env.get("AWS_SES_REGION")?.trim();
  if (region) return `email-smtp.${region}.amazonaws.com`;
  throw new Error("SMTP_HOST or AWS_SES_REGION is required");
}

/** Edge blocks 25/587 — remap SES to 2587 (STARTTLS). */
function resolveSmtpPort(host: string): number {
  const raw = Deno.env.get("SMTP_PORT")?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) throw new Error("SMTP_PORT must be a number");
    if (host.includes("amazonaws.com") && (n === 587 || n === 25)) return 2587;
    return n;
  }
  return host.includes("amazonaws.com") ? 2587 : 587;
}

function resolveFrom(): string {
  const from = Deno.env.get("SMTP_FROM")?.trim();
  if (!from) throw new Error("SMTP_FROM is required");
  return from.includes("<") ? from : `"System Bunny" <${from}>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildVerifyUrl(
  tokenHash: string,
  type: string,
  redirectTo: string,
): string | null {
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  if (!base || !tokenHash) return null;
  const url = new URL(`${base}/auth/v1/verify`);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", type);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

function resolveRedirectTo(emailData: HookPayload["email_data"]): string {
  const fromHook = emailData.redirect_to?.trim();
  if (fromHook && !fromHook.includes("localhost:1420")) return fromHook;
  const fromEnv = Deno.env.get("AUTH_REDIRECT_URL")?.trim();
  if (fromEnv) return fromEnv;
  if (fromHook) return fromHook;
  return emailData.site_url?.trim() || "";
}

function ctaButton(href: string, label: string): string {
  return (
    `<p style="margin:24px 0">` +
    `<a href="${escapeHtml(href)}" ` +
    `style="display:inline-block;padding:12px 22px;border-radius:10px;` +
    `background:#3d8bfd;color:#ffffff;text-decoration:none;font-weight:700">` +
    `${escapeHtml(label)}</a></p>`
  );
}

function codeBlock(token: string): string {
  return (
    `<p style="font-size:28px;font-weight:700;letter-spacing:0.12em;` +
    `font-family:ui-monospace,Consolas,monospace">${escapeHtml(token)}</p>`
  );
}

function buildMessage(
  action: EmailActionType,
  token: string,
  tokenHash: string,
  redirectTo: string,
): { subject: string; text: string; html: string } {
  const verifyType =
    action === "magiclink" || action === "email"
      ? "magiclink"
      : action === "recovery"
        ? "recovery"
        : action === "email_change"
          ? "email_change"
          : action === "invite"
            ? "invite"
            : "signup";

  const verifyUrl = buildVerifyUrl(tokenHash, verifyType, redirectTo);

  switch (action) {
    case "signup":
    case "invite": {
      const subject =
        action === "invite"
          ? "You’re invited to System Bunny"
          : "Confirm your System Bunny account";
      if (verifyUrl) {
        return {
          subject,
          text:
            `Welcome to System Bunny.\n\nConfirm your email:\n${verifyUrl}\n\n` +
            `Or enter this code in the app:\n${token}\n`,
          html:
            `<h2>Welcome to System Bunny</h2>` +
            `<p>Confirm your email to finish setup.</p>` +
            ctaButton(verifyUrl, "Confirm email") +
            `<p>Or enter this code in the app:</p>${codeBlock(token)}`,
        };
      }
      return {
        subject,
        text: `Welcome to System Bunny.\n\nEnter this confirmation code:\n\n${token}\n`,
        html:
          `<h2>Welcome to System Bunny</h2>` +
          `<p>Enter this confirmation code in the app:</p>${codeBlock(token)}`,
      };
    }
    case "magiclink":
    case "email":
      return {
        subject: "Your System Bunny sign-in code",
        text: `Your System Bunny login code is:\n\n${token}\n\nEnter it in the app to sign in.\n`,
        html:
          `<h2>Your System Bunny sign-in code</h2>` +
          `<p>Enter this one-time code in the app to log in:</p>${codeBlock(token)}`,
      };
    case "recovery": {
      // Desktop-only reset: code in the app. Never include verify links/buttons.
      const subject = "Your System Bunny password reset code";
      const text =
        `Your System Bunny password reset code is:\n\n${token}\n\n` +
        `Open System Bunny → Forgot password → enter this code, then choose a new password.\n` +
        `Do not share this code. If you did not ask to reset your password, ignore this email.\n`;
      const html =
        `<h2>Your System Bunny password reset code</h2>` +
        `<p>Use this code in the <strong>System Bunny</strong> app to reset your password:</p>` +
        codeBlock(token) +
        `<p>In the app: <strong>Forgot password</strong> → enter the code → set a new password.</p>` +
        `<p style="color:#667;font-size:13px">Do not share this code. If you did not request a reset, you can ignore this email.</p>`;
      return { subject, text, html };
    }
    case "email_change": {
      if (verifyUrl) {
        return {
          subject: "Confirm your new System Bunny email",
          text:
            `Confirm your new email:\n${verifyUrl}\n\nOr enter this code:\n${token}\n`,
          html:
            `<h2>Confirm your new email</h2>` +
            ctaButton(verifyUrl, "Confirm email") +
            `<p>Or enter this code:</p>${codeBlock(token)}`,
        };
      }
      return {
        subject: "Confirm your new System Bunny email",
        text: `Enter this code to confirm your new email:\n\n${token}\n`,
        html:
          `<h2>Confirm your new email</h2>` +
          `<p>Enter this code:</p>${codeBlock(token)}`,
      };
    }
    default:
      return {
        subject: "Your System Bunny code",
        text: `Your System Bunny code:\n\n${token}\n`,
        html: `<h2>Your System Bunny code</h2>${codeBlock(token)}`,
      };
  }
}

/** SES SMTP via nodemailer (port 2587 on Edge — 587 is blocked). */
async function sendViaSesSmtp(
  to: string,
  subject: string,
  text: string,
  html: string,
) {
  const user = Deno.env.get("SMTP_USER")?.trim();
  const pass = Deno.env.get("SMTP_PASS")?.trim();
  if (!user || !pass) {
    throw new Error("SMTP_USER / SMTP_PASS are not configured");
  }

  const host = resolveSmtpHost();
  const port = resolveSmtpPort(host);

  // Dynamic import keeps the Auth hook response under 5s on cold starts.
  const nodemailer = (await import("npm:nodemailer@6.10.1")).default;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  });

  try {
    await transporter.sendMail({
      from: resolveFrom(),
      to,
      subject,
      text,
      html,
    });
  } finally {
    transporter.close();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return hookError(400, "POST required");
  }

  const hookSecrets = Deno.env.get("SEND_EMAIL_HOOK_SECRETS")?.trim();
  if (!hookSecrets) {
    return hookError(500, "SEND_EMAIL_HOOK_SECRETS is not configured");
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const secret = hookSecrets.replace("v1,whsec_", "");

  try {
    const wh = new Webhook(secret);
    const event = wh.verify(payload, headers) as HookPayload;
    const email = event.user?.email?.trim();
    const token = event.email_data?.token?.trim();
    const tokenHash = event.email_data?.token_hash?.trim() || "";
    const action = (event.email_data?.email_action_type ?? "email").trim();
    const redirectTo = resolveRedirectTo(event.email_data ?? {});

    if (!email) {
      return hookError(400, "Missing user email in hook payload");
    }
    if (!token) {
      return hookError(400, "Missing token in email_data");
    }

    const message = buildMessage(action, token, tokenHash, redirectTo);

    // Ack Auth immediately, then deliver via SES in the background. Awaiting
    // nodemailer on cold start exceeds Auth's ~5s hook limit.
    const sendPromise = sendViaSesSmtp(
      email,
      message.subject,
      message.text,
      message.html,
    )
      .then(() => console.log(`send-email ok action=${action} to=${email}`))
      .catch((err) =>
        console.error(
          "send-email SES delivery failed:",
          err instanceof Error ? err.message : String(err),
        ),
      );

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(sendPromise);
    } else {
      await sendPromise;
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-email hook failed:", message);

    const retryable =
      /smtp|ses|econn|etimedout|network|fetch|454|421/i.test(message);

    return hookError(
      retryable ? 503 : 400,
      `Failed to send email: ${message}`,
      retryable,
    );
  }
});
