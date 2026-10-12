import { useEffect, useState } from "react";
import { ProfileMenu } from "./ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import { useAuth } from "../context/AuthContext";
import { useWorkSession } from "../context/WorkSessionContext";

export function StartScreen() {
  const {
    user,
    emailVerified,
    resendVerificationEmail,
    refreshUser,
  } = useAuth();
  const { startSession } = useWorkSession();
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);

  const name =
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "there";

  useEffect(() => {
    if (emailVerified) return;

    const onFocus = () => {
      void refreshUser();
    };

    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => {
      void refreshUser();
    }, 12_000);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [emailVerified, refreshUser]);

  const onResend = async () => {
    setResendError(null);
    setResendNotice(null);
    setResending(true);
    const result = await resendVerificationEmail();
    if (result.error) setResendError(result.error);
    else setResendNotice("Verification email sent. Check your inbox.");
    setResending(false);
  };

  const onCheckVerified = async () => {
    setResendError(null);
    setChecking(true);
    const verified = await refreshUser();
    if (!verified) {
      setResendError("Email not verified yet. Open the link from your inbox, then try again.");
    }
    setChecking(false);
  };

  return (
    <div className="shell start-screen">
      <header className="topbar" data-tauri-drag-region>
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-mark__glyph">S</span>
        </div>
        <div className="topbar__actions">
          <ThemeToggle />
          <ProfileMenu />
          <WindowControls />
        </div>
      </header>

      <main className="start-screen__content">
        <p className="eyebrow">Ready when you are</p>
        <h1 className="brand-title">Hi, {name}</h1>
        <p className="tagline">
          Start a focus session to open chat. Use Ctrl/⌘+A to hide or show the
          overlay. Close quits the app.
        </p>

        {!emailVerified && (
          <div className="verify-banner" role="status">
            <p className="verify-banner__title">Verify your email to start</p>
            <p className="verify-banner__body">
              We sent a confirmation link to <strong>{user?.email}</strong>.
              You can stay signed in, but chat stays locked until you verify.
            </p>
            <div className="verify-banner__actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void onResend()}
                disabled={resending}
              >
                {resending ? "Sending…" : "Resend email"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void onCheckVerified()}
                disabled={checking}
              >
                {checking ? "Checking…" : "I’ve verified"}
              </button>
            </div>
            {resendNotice && <p className="auth-notice">{resendNotice}</p>}
            {resendError && (
              <p className="auth-error" role="alert">
                {resendError}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          className="start-button"
          onClick={() => void startSession()}
          disabled={!emailVerified}
          aria-disabled={!emailVerified}
          title={
            emailVerified
              ? "Begin session"
              : "Verify your email before starting a session"
          }
        >
          <span className="start-button__label">Start</span>
          <span className="start-button__hint">
            {emailVerified ? "Begin session" : "Verify email first"}
          </span>
        </button>
      </main>
    </div>
  );
}
