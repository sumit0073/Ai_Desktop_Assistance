/**
 * Local SES SMTP probe using .env SMTP_* (same as Edge send-email).
 */
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

function loadEnv(path) {
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

const env = loadEnv(".env");
const host = env.SMTP_HOST || `email-smtp.${env.AWS_SES_REGION}.amazonaws.com`;
const ports = [2587, 587, Number(env.SMTP_PORT) || 2587].filter(
  (p, i, a) => a.indexOf(p) === i,
);
const to = "sumitkumar302100@gmail.com";

for (const port of ports) {
  const started = Date.now();
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 12000,
    });
    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `System Bunny SMTP probe port ${port}`,
      text: `Probe ok on port ${port} at ${new Date().toISOString()}`,
    });
    console.log(
      JSON.stringify({
        ok: true,
        port,
        ms: Date.now() - started,
        messageId: info.messageId,
      }),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        ok: false,
        port,
        ms: Date.now() - started,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
