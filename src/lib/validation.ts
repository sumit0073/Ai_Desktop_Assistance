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

/** Avoid leaking raw provider errors to the UI. */
export function mapAuthError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (lower.includes("email not confirmed")) {
    return "Email still needs confirmation in Supabase. Run the auto_confirm_email migration in the SQL Editor, or enable “Allow unverified email sign-ins” under Authentication → Providers → Email.";
  }
  if (lower.includes("user already registered")) {
    return "An account with this email already exists.";
  }
  if (lower.includes("password should be at least")) {
    return "Password does not meet security requirements.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }

  return "Unable to complete authentication. Please try again.";
}
