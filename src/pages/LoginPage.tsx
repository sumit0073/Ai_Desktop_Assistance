import { useState, type FormEvent } from "react";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { validateEmail } from "../lib/validation";

type Props = {
  notice?: string | null;
  onForgotPassword?: () => void;
  onOtpLogin?: () => void;
  onNeedsEmailVerification?: (email: string) => void;
};

function isUnconfirmedEmailError(message: string | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("email not confirmed") ||
    lower.includes("email still needs confirmation") ||
    lower.includes("confirm your email")
  );
}

export function LoginPage({
  notice = null,
  onForgotPassword,
  onOtpLogin,
  onNeedsEmailVerification,
}: Props) {
  const { signIn, signInWithGoogle, configured, googleConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

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
    setSubmitting(false);

    if (authError && isUnconfirmedEmailError(authError)) {
      setError(authError);
      onNeedsEmailVerification?.(email.trim());
      return;
    }

    if (authError) setError(authError);
  };

  const onGoogleSignIn = async () => {
    setError(null);
    setGoogleSubmitting(true);
    const { error: authError } = await signInWithGoogle();
    setGoogleSubmitting(false);
    if (authError) setError(authError);
  };

  const busy = submitting || googleSubmitting;

  return (
    <form
      id="auth-panel-login"
      role="tabpanel"
      aria-labelledby="auth-tab-login"
      className="auth-form"
      onSubmit={(e) => void onSubmit(e)}
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
      {configured && !googleConfigured && (
        <p className="auth-hint">
          Add <code>VITE_GOOGLE_CLIENT_ID</code> to <code>.env</code> for Google
          sign-in.
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

      {error && isUnconfirmedEmailError(error) && onNeedsEmailVerification && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onNeedsEmailVerification(email.trim())}
        >
          Enter verification code
        </button>
      )}

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <div className="auth-alt-actions">
        <button
          type="button"
          className="btn btn-ghost auth-alt-actions__btn"
          disabled={busy || !configured}
          onClick={() => void onGoogleSignIn()}
        >
          {googleSubmitting ? "Signing in…" : "Google sign in"}
        </button>
        {onOtpLogin && (
          <button
            type="button"
            className="btn btn-ghost auth-alt-actions__btn"
            disabled={busy}
            onClick={onOtpLogin}
          >
            Sign in with OTP
          </button>
        )}
      </div>
    </form>
  );
}
