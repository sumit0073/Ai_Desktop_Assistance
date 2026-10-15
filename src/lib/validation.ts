import { digitsOnly, type PhoneCountrySelection } from "./countryPhone";
import { validateFeasiblePhone } from "./phoneValidation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  const digits = digitsOnly(phone);
  if (!digits) return "";
  return `+${digits}`;
}

export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email);
  if (!value) return "Email is required.";
  if (!EMAIL_RE.test(value)) return "Enter a valid email address.";
  return null;
}

export function validatePhone(
  nationalNumber: string,
  country: PhoneCountrySelection,
): string | null {
  return validateFeasiblePhone(nationalNumber, country);
}

export function validateName(name: string): string | null {
  const value = name.trim();
  if (!value) return "Name is required.";
  if (value.length < 2) return "Name must be at least 2 characters.";
  if (value.length > 80) return "Name must be under 80 characters.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password needs letters and at least one number.";
  }
  return null;
}

export function validatePasswordConfirm(
  password: string,
  confirmPassword: string,
): string | null {
  if (!confirmPassword) return "Confirm your password.";
  if (password !== confirmPassword) return "Passwords do not match.";
  return null;
}

export function validateOtpCode(token: string): string | null {
  const value = token.trim();
  if (!value) return "Enter the code we sent you.";
  if (!/^\d{6}$/.test(value)) return "Enter the 6-digit code.";
  return null;
}

/** Avoid leaking raw provider errors to the UI. */
export function mapAuthError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email first. Enter the verification code from System Bunny, then sign in.";
  }
  if (lower.includes("user already registered")) {
    return "An account with this email already exists.";
  }
  if (lower.includes("password should be at least")) {
    return "Password does not meet security requirements.";
  }
  if (
    lower.includes("otp") &&
    (lower.includes("expired") || lower.includes("invalid") || lower.includes("token"))
  ) {
    return "That code is invalid or expired. Request a new one.";
  }
  if (lower.includes("token has expired") || lower.includes("invalid token")) {
    return "That code is invalid or expired. Request a new one.";
  }
  if (lower.includes("otp_disabled") || lower.includes("signups not allowed for otp")) {
    return "No account found for that email or phone. Sign up first with that phone, or use password sign-in.";
  }
  if (
    lower.includes("user not found") ||
    lower.includes("unable to validate email") ||
    (lower.includes("phone") && lower.includes("not found"))
  ) {
    return "No account found for that email or phone. Sign up first, or use password sign-in.";
  }
  if (
    lower.includes("phone provider") ||
    lower.includes("unsupported phone") ||
    lower.includes("sms provider")
  ) {
    return "Phone sign-in isn’t enabled yet. Enable Phone auth and the Send SMS hook in the Supabase Dashboard.";
  }
  if (
    lower.includes("sms") &&
    (lower.includes("provider") || lower.includes("twilio") || lower.includes("not enabled"))
  ) {
    return "SMS sign-in isn’t configured yet. Enable Phone auth and an SMS provider in the Supabase Dashboard.";
  }
  if (lower.includes("phone") && lower.includes("provider")) {
    return "SMS sign-in isn’t configured yet. Enable Phone auth and an SMS provider in the Supabase Dashboard.";
  }
  if (
    lower.includes("over_email_send_rate_limit") ||
    lower.includes("email rate limit") ||
    (lower.includes("email") && lower.includes("rate limit"))
  ) {
    return "Email send limit reached. Password sign-in still works — try again shortly.";
  }
  // Auth OTP / recovery cooldown: "For security purposes, you can only request this after N seconds."
  if (
    lower.includes("for security purposes") ||
    lower.includes("only request this after") ||
    lower.includes("only request this")
  ) {
    const wait = message.match(/after\s+(\d+)\s+seconds?/i)?.[1];
    return wait
      ? `Please wait ${wait} seconds before requesting another reset code.`
      : "Please wait a moment before requesting another reset code.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Try again shortly. Password sign-in still works.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }
  if (
    lower.includes("redirect") ||
    lower.includes("redirect_uri") ||
    lower.includes("not allowed") ||
    lower.includes("invalid redirect")
  ) {
    return "Password reset redirect isn’t allowed. Set VITE_AUTH_REDIRECT_URL to an https URL listed under Authentication → URL Configuration.";
  }
  if (
    lower.includes("hook") ||
    lower.includes("error sending") ||
    lower.includes("failed to reach") ||
    lower.includes("confirmation email") ||
    lower.includes("recovery email")
  ) {
    return "Could not send the reset email (SES hook). Try again, or check Authentication → Hooks → Send Email.";
  }

  // Surface a short Auth message instead of a useless generic (still no stack traces).
  const trimmed = message.trim();
  if (trimmed.length > 0 && trimmed.length <= 160) {
    return trimmed;
  }

  return "Unable to complete authentication. Please try again.";
}
