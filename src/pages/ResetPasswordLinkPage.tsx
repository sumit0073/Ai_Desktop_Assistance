import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { mapAuthError, validatePassword, validatePasswordConfirm } from "../lib/validation";

type Props = {
  onDone: () => void;
};

/**
 * Opened from an Auth recovery redirect (?code=… or #access_token=…&type=recovery).
 * Normal desktop reset uses the in-app code on Forgot password instead.
 */
export function ResetPasswordLinkPage({ onDone }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>("Opening your reset link…");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setError("Supabase is not configured.");
      setNotice(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (code) {
          const { error: exchangeError } =
            await client.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          const { data } = await client.auth.getSession();
          if (!data.session) {
            throw new Error(
              "This reset link is invalid or expired. Request a new one from the app.",
            );
          }
        }

        if (cancelled) return;
        // Drop tokens from the address bar.
        window.history.replaceState({}, "", `${url.origin}${url.pathname}`);
        setNotice("Choose a new password for your account.");
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(mapAuthError(message));
        setNotice(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setError(null);

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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(mapAuthError(updateError.message));
      return;
    }

    setNotice("Password updated. You can sign in with your new password.");
    setReady(false);
    window.setTimeout(() => onDone(), 1200);
  };

  return (
    <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
      <h2 className="auth-form__title">Reset password</h2>
      {notice && (
        <p className="auth-form__notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="auth-form__error" role="alert">
          {error}
        </p>
      )}
      {ready && (
        <>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : "Update password"}
          </button>
        </>
      )}
      {!ready && error && (
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Back to sign in
        </button>
      )}
    </form>
  );
}

export function isPasswordResetLinkLocation(
  loc: Pick<Location, "pathname" | "search" | "hash"> = window.location,
): boolean {
  if (loc.pathname.replace(/\/$/, "").endsWith("/reset-password")) return true;
  const q = new URLSearchParams(loc.search);
  if (q.has("code")) return true;
  const hash = new URLSearchParams(loc.hash.replace(/^#/, ""));
  return hash.get("type") === "recovery" && Boolean(hash.get("access_token"));
}
