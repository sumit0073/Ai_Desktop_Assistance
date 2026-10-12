import { useState, type FormEvent } from "react";
import { PasswordField } from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { DEMO_CREDENTIALS } from "../lib/demoCredentials";
import { validateEmail } from "../lib/validation";

export function LoginPage() {
  const { signIn, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fillDemo = () => {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
    setError(null);
  };

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

      {!configured && (
        <p className="auth-hint">
          Connect Supabase in <code>.env</code> to enable real auth.
        </p>
      )}
      <p className="auth-hint">
        Demo — email <code>{DEMO_CREDENTIALS.email}</code>, password{" "}
        <code>{DEMO_CREDENTIALS.password}</code>
      </p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <button type="button" className="btn btn-ghost demo-row" onClick={fillDemo}>
        Use demo credentials
      </button>
    </form>
  );
}
