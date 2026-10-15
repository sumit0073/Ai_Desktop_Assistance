import { useState, type FormEvent } from "react";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { validateEmail } from "../lib/validation";

type Props = {
  notice?: string | null;
  onForgotPassword?: () => void;
  onOtpLogin?: () => void;
};

export function LoginPage({
  notice = null,
  onForgotPassword,
  onOtpLogin,
}: Props) {
  const { signIn, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }

    setSubmitting(true);
    const { error: authError } = await signIn({ email, password });
    if (authError) setError(authError);
    setSubmitting(false);
  };

  return (
    <form
      id="auth-panel-login"
      role="tabpanel"
      aria-labelledby="auth-tab-login"
      className="auth-form"
      onSubmit={onSubmit}
      noValidate
    >
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

      <div className="auth-password-block">
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
          placeholder="Your password"
          visible={showPassword}
          onToggleVisible={() => setShowPassword((v) => !v)}
        />
        {onForgotPassword && (
          <button
            type="button"
            className="link-btn auth-forgot-link"
            onClick={onForgotPassword}
          >
            Forgot password?
          </button>
        )}
      </div>

      {!configured && (
        <p className="auth-hint">
          Connect Supabase in <code>.env</code> to enable real auth.
        </p>
      )}
      {typeof notice === "string" && notice.length > 0 && (
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
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      {onOtpLogin && (
        <p className="auth-switch">
          Prefer a code?{" "}
          <button type="button" className="link-btn" onClick={onOtpLogin}>
            Sign in with OTP
          </button>
        </p>
      )}
    </form>
  );
}
