import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { validateEmail } from "../lib/validation";

type Props = {
  onBackToLogin: () => void;
};

export function ForgotPasswordPage({ onBackToLogin }: Props) {
  const { requestPasswordReset, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }

    setSubmitting(true);
    const { error: authError } = await requestPasswordReset({ email });
    setSubmitting(false);

    if (authError) {
      setError(authError);
      return;
    }

    setSent(true);
  };

  return (
    <form
      id="auth-panel-forgot"
      className="auth-form"
      onSubmit={onSubmit}
      noValidate
    >
      <p className="auth-hint">
        Enter the email for your account and we’ll send a reset link.
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
          onChange={(e) => {
            setEmail(e.target.value);
            setSent(false);
          }}
          placeholder="priya.sharma@gmail.com"
        />
      </label>

      {!configured && (
        <p className="auth-hint">
          Connect Supabase in <code>.env</code> to enable password reset.
        </p>
      )}
      {sent && (
        <p className="auth-notice" role="status">
          Send successful. Check your inbox or spam.
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? "Sending…" : "Send reset link"}
      </button>

      <p className="auth-switch">
        <button type="button" className="link-btn" onClick={onBackToLogin}>
          Back to sign in
        </button>
      </p>
    </form>
  );
}
