import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { digitsOnly } from "../lib/countryPhone";
import { validateEmail, validateOtpCode } from "../lib/validation";

type Props = {
  initialEmail?: string;
  onBackToLogin: () => void;
  onVerified?: () => void;
};

const RESEND_COOLDOWN_SEC = 60;

export function VerifyEmailPage({
  initialEmail = "",
  onBackToLogin,
  onVerified,
}: Props) {
  const { verifySignupEmail, resendSignupEmail, configured, signOut } =
    useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  const onVerify = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    const codeError = validateOtpCode(token);
    if (codeError) {
      setError(codeError);
      return;
    }

    setSubmitting(true);
    const { error: authError } = await verifySignupEmail({ email, token });
    setSubmitting(false);

    if (authError) {
      setError(authError);
      return;
    }

    setNotice("Email verified. You’re signed in.");
    onVerified?.();
  };

  const onResend = async () => {
    if (resendIn > 0) return;
    setError(null);
    setNotice(null);

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }

    setSubmitting(true);
    const { error: authError } = await resendSignupEmail({ email });
    setSubmitting(false);

    if (authError) {
      setError(authError);
      return;
    }

    setResendIn(RESEND_COOLDOWN_SEC);
    setNotice("New verification code sent from System Bunny.");
  };

  const onBack = async () => {
    await signOut();
    onBackToLogin();
  };

  return (
    <form
      id="auth-panel-verify-email"
      className="auth-form auth-form--verify"
      onSubmit={(e) => void onVerify(e)}
      noValidate
    >
      <h2 className="auth-form__title">Verify your email</h2>
      <p className="auth-form__subtitle">
        Sign in with your email and password, then enter the 6-digit code from
        your System Bunny email. Use Resend code if it expired.
      </p>

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

      <label>
        <span>Verification code</span>
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

      {!configured && (
        <p className="auth-hint">
          Connect Supabase in <code>.env</code> to enable email verification.
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
        {submitting ? "Verifying…" : "Verify email"}
      </button>

      <button
        type="button"
        className="btn btn-ghost"
        disabled={submitting || resendIn > 0}
        onClick={() => void onResend()}
      >
        {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
      </button>

      <p className="auth-switch">
        <button type="button" className="link-btn" onClick={() => void onBack()}>
          Back to sign in
        </button>
      </p>
    </form>
  );
}
