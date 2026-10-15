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

const BRAND = {
  accent: "#0c6b5c",
  accentSoft: "#e7f5f2",
  ink: "#102433",
  muted: "#5a6f7d",
  line: "#d7e2e8",
  bg: "#f4f7f9",
  white: "#ffffff",
} as const;

function ctaButton(href: string, label: string): string {
  return (
    `<p style="margin:24px 0">` +
    `<a href="${escapeHtml(href)}" ` +
    `style="display:inline-block;padding:12px 22px;border-radius:10px;` +
    `background:${BRAND.accent};color:#ffffff;text-decoration:none;font-weight:700">` +
    `${escapeHtml(label)}</a></p>`
  );
}

function codeBlock(token: string): string {
  return (
    `<p style="font-size:28px;font-weight:700;letter-spacing:0.12em;` +
    `font-family:ui-monospace,Consolas,monospace;color:${BRAND.ink}">` +
    `${escapeHtml(token)}</p>`
  );
}

/** Table-based shell for Gmail / Outlook / mobile (inline CSS only). */
function wrapTransactionalHtml(innerHtml: string): string {
  return (
    `<!DOCTYPE html>` +
    `<html lang="en">` +
    `<head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<meta http-equiv="x-ua-compatible" content="ie=edge" />` +
    `<title>System Bunny</title></head>` +
    `<body style="margin:0;padding:0;background:${BRAND.bg};` +
    `-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${BRAND.bg};padding:28px 12px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="max-width:560px;background:${BRAND.white};border:1px solid ${BRAND.line};` +
    `border-radius:14px;overflow:hidden;">` +
    `<tr><td style="padding:18px 28px;border-bottom:1px solid ${BRAND.line};` +
    `font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;` +
    `letter-spacing:0.02em;color:${BRAND.accent};">System Bunny</td></tr>` +
    `<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;` +
    `color:${BRAND.ink};font-size:15px;line-height:1.55;">${innerHtml}</td></tr>` +
    `<tr><td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif;` +
    `font-size:12px;line-height:1.5;color:${BRAND.muted};border-top:1px solid ${BRAND.line};">` +
    `© System Bunny. All rights reserved.</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

function verificationCodeBox(token: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="margin:22px 0;">` +
    `<tr><td align="center" style="background:${BRAND.accentSoft};border:1px solid ${BRAND.line};` +
    `border-radius:12px;padding:18px 16px;">` +
    `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;` +
    `font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.accent};">` +
    `Verification code</p>` +
    `<p style="margin:0;font-family:Consolas,'Courier New',monospace;font-size:32px;` +
    `font-weight:700;letter-spacing:0.28em;color:${BRAND.ink};line-height:1.2;">` +
    `${escapeHtml(token)}</p>` +
    `</td></tr></table>`
  );
}

/** Signup / resend confirmation — OTP in app only (no verify links). */
function buildSignupVerificationEmail(
  token: string,
  kind: "signup" | "invite",
): { subject: string; text: string; html: string } {
  const subject =
    kind === "invite"
      ? "You’re invited to System Bunny — verify your email"
      : "Verify your email address to get started with System Bunny";

  const text =
    `Welcome to System Bunny!\n\n` +
    `Thanks for creating your System Bunny account. To complete your registration ` +
    `and access your account, verify your email with this code:\n\n` +
    `${token}\n\n` +
    `How to verify your email:\n` +
    `1. Open System Bunny.\n` +
    `2. Log in using your email address and password.\n` +
    `3. You will see an option to enter your verification code.\n` +
    `4. Enter the verification code from this email.\n` +
    `5. Click Verify email to complete the process.\n\n` +
    `If your code expired: in System Bunny choose Resend code, then enter the new code.\n\n` +
    `For your security, never share your verification code with anyone. ` +
    `If you did not create a System Bunny account, you can safely ignore this email.\n\n` +
    `© System Bunny. All rights reserved.\n`;

  const html = wrapTransactionalHtml(
    `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;font-weight:700;` +
      `color:${BRAND.ink};">Verify your email address</h1>` +
      `<p style="margin:0 0 14px;font-size:16px;font-weight:700;color:${BRAND.ink};">` +
      `Welcome to System Bunny!</p>` +
      `<p style="margin:0 0 8px;color:${BRAND.muted};">` +
      `Thanks for creating your System Bunny account. To complete your registration ` +
      `and access your account, please verify your email address using the verification ` +
      `code below.</p>` +
      verificationCodeBox(token) +
      `<h2 style="margin:8px 0 10px;font-size:16px;line-height:1.3;font-weight:700;` +
      `color:${BRAND.ink};">How to verify your email</h2>` +
      `<ol style="margin:0 0 18px;padding-left:20px;color:${BRAND.muted};">` +
      `<li style="margin:0 0 8px;">Open <strong style="color:${BRAND.ink};">System Bunny</strong>.</li>` +
      `<li style="margin:0 0 8px;">Log in using your email address and password.</li>` +
      `<li style="margin:0 0 8px;">You will see an option to enter your verification code.</li>` +
      `<li style="margin:0 0 8px;">Enter the verification code from this email.</li>` +
      `<li style="margin:0 0 8px;">Click <strong style="color:${BRAND.ink};">Verify email</strong> ` +
      `to complete the process.</li>` +
      `</ol>` +
      `<h2 style="margin:4px 0 10px;font-size:16px;line-height:1.3;font-weight:700;` +
      `color:${BRAND.ink};">Is your verification code expired?</h2>` +
      `<p style="margin:0 0 18px;color:${BRAND.muted};">` +
      `If your verification code has expired, return to System Bunny and select ` +
      `<strong style="color:${BRAND.ink};">Resend code</strong>. Check your email for the new code, ` +
      `enter it in the verification field, and click ` +
      `<strong style="color:${BRAND.ink};">Verify email</strong>.</p>` +
      `<p style="margin:0;padding:14px 16px;background:${BRAND.bg};border-radius:10px;` +
      `border:1px solid ${BRAND.line};font-size:13px;color:${BRAND.muted};">` +
      `<strong style="color:${BRAND.ink};">Security notice:</strong> For your security, never share ` +
      `your verification code with anyone. If you did not create a System Bunny account, ` +
      `you can safely ignore this email.</p>`,
  );

  return { subject, text, html };
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
    case "invite":
      // Desktop OTP flow via SES — no confirm link/button.
      return buildSignupVerificationEmail(
        token,
        action === "invite" ? "invite" : "signup",
      );
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
