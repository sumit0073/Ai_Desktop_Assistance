import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { digitsOnly } from "../lib/countryPhone";
import {
  validateEmail,
  validateOtpCode,
  validatePassword,
  validatePasswordConfirm,
} from "../lib/validation";

type Props = {
  onBackToLogin: () => void;
};

type Step = "request" | "reset";

const RESEND_COOLDOWN_SEC = 60;

export function ForgotPasswordPage({ onBackToLogin }: Props) {
  const { requestPasswordReset, completePasswordReset, configured } = useAuth();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  const sendResetCode = async (): Promise<string | null> => {
    const emailError = validateEmail(email);
    if (emailError) return emailError;
    const { error: authError } = await requestPasswordReset({ email });
    return authError;
  };

  const onRequest = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    setSubmitting(true);
    const authError = await sendResetCode();
    setSubmitting(false);

    if (authError) {
      setError(authError);
      return;
    }

    setResendIn(RESEND_COOLDOWN_SEC);
    setStep("reset");
  };

  const onComplete = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const codeError = validateOtpCode(token);
    if (codeError) {
      setError(codeError);
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    const confirmError = validatePasswordConfirm(password, confirmPassword);
    if (confirmError) {
      setError(confirmError);
      return;
    }

    setSubmitting(true);
    const { error: authError } = await completePasswordReset({
      channel: "email",
      email,
      token,
      password,
    });
    setSubmitting(false);

    if (authError) {
      setError(authError);
    }
  };

  const onResend = async () => {
    if (resendIn > 0) return;
    setError(null);
    setSubmitting(true);
    const authError = await sendResetCode();
    setSubmitting(false);

    if (authError) {
      setError(authError);
      return;
    }

    setResendIn(RESEND_COOLDOWN_SEC);
    setNotice("Code resent.");
  };

  return (
    <form
      id="auth-panel-forgot"
      className="auth-form auth-form--forgot"
      onSubmit={step === "request" ? onRequest : onComplete}
      noValidate
    >
      <h2 className="auth-form__title">Forgot password</h2>
      <p className="auth-form__subtitle">
        {step === "request"
          ? "Enter your account email to get a reset code."
          : "Enter the code from your email, then choose a new password."}
      </p>

      {step === "request" && (
        <label>
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="priya.sharma@gmail.com"
          />
        </label>
      )}

      {step === "reset" && (
        <>
          <label>
            <span>Reset code</span>
            <input
              type="text"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={token}
              onChange={(e) => setToken(digitsOnly(e.target.value).slice(0, 6))}
              placeholder="6-digit code"
            />
          </label>
          <label>
            <span>New password</span>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <label>
            <span>Confirm password</span>
            <input
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
            />
          </label>
        </>
      )}

      {!configured && (
        <p className="auth-hint">
          Connect Supabase in <code>.env</code> to enable password reset.
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting
          ? step === "request"
            ? "Sending…"
            : "Updating…"
          : step === "request"
            ? "Send reset code"
            : "Set new password"}
      </button>

      {step === "reset" && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={submitting || resendIn > 0}
          onClick={() => void onResend()}
        >
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
        </button>
      )}

      <p className="auth-switch">
        <button type="button" className="link-btn" onClick={onBackToLogin}>
          Back to sign in
        </button>
      </p>
    </form>
  );
}
