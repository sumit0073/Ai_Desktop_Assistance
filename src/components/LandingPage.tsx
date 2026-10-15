import { useState } from "react";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { OtpLoginPage } from "../pages/OtpLoginPage";
import {
  isPasswordResetLinkLocation,
  ResetPasswordLinkPage,
} from "../pages/ResetPasswordLinkPage";
import { SignupPage } from "../pages/SignupPage";
import { VerifyEmailPage } from "../pages/VerifyEmailPage";
import { AuthTabs } from "./AuthTabs";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import bunnyLogo from "../assets/system-bunny-logo.png";

type AuthView =
  | "login"
  | "signup"
  | "forgot"
  | "otp"
  | "reset-link"
  | "verify-email";

type Props = {
  /** Prefill verify screen when App gates an unverified session. */
  forceVerifyEmail?: string | null;
};

export function LandingPage({ forceVerifyEmail = null }: Props) {
  const [view, setView] = useState<AuthView>(() => {
    if (forceVerifyEmail) return "verify-email";
    return isPasswordResetLinkLocation() ? "reset-link" : "login";
  });
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState(forceVerifyEmail ?? "");

  const switchView = (next: AuthView) => {
    if (next === view) return;
    if (next === "signup" || next === "forgot" || next === "otp") {
      setAuthNotice(null);
    }
    setView(next);
  };

  const backToLogin = (notice?: string | null) => {
    // Callers sometimes wire this to onClick — ignore non-string args (MouseEvent).
    setAuthNotice(typeof notice === "string" ? notice : null);
    setView("login");
  };

  const openVerifyEmail = (email: string, notice?: string | null) => {
    setVerifyEmail(email);
    setAuthNotice(typeof notice === "string" ? notice : null);
    setView("verify-email");
  };

  const showTabs = view === "login" || view === "signup";

  return (
    <div className={`shell landing landing--${view}`}>
      <header className="topbar" data-tauri-drag-region>
        <div className="brand-mark brand-mark--logo" aria-hidden="true">
          <img src={bunnyLogo} alt="" draggable={false} />
        </div>
        <div className="topbar__actions">
          <ThemeToggle />
          <WindowControls />
        </div>
      </header>

      <main className="landing__content">
        <section className="hero-copy">
          <p className="eyebrow">Desktop overlay</p>
          <h1 className="brand-title">System Bunny</h1>
          {view === "login" && (
            <p className="tagline">
              Stay on the problem. Ask sharp questions, get clear answers —
              without leaving your screen.
            </p>
          )}
          {view === "forgot" && (
            <p className="tagline">
              Reset your password here — this is not sign-in. We’ll email a code
              from System Bunny.
            </p>
          )}
          {view === "otp" && (
            <p className="tagline">
              Sign in with a one-time code sent to your email or phone.
            </p>
          )}
          {view === "reset-link" && (
            <p className="tagline">
              Choose a new password. This page opened from your reset email.
            </p>
          )}
          {view === "verify-email" && (
            <p className="tagline">
              Confirm your email with the code from System Bunny before you
              start.
            </p>
          )}
        </section>

        <div className="auth-panel">
          {showTabs && (
            <AuthTabs
              active={view === "signup" ? "signup" : "login"}
              onChange={(next) => switchView(next)}
            />
          )}
          <div key={view} className="auth-panel__body">
            {view === "login" && (
              <LoginPage
                notice={authNotice}
                onForgotPassword={() => switchView("forgot")}
                onOtpLogin={() => switchView("otp")}
                onNeedsEmailVerification={(email) =>
                  openVerifyEmail(
                    email,
                    "Confirm your email with the code we sent, then sign in again if needed.",
                  )
                }
              />
            )}
            {view === "signup" && (
              <SignupPage
                onSwitchToLogin={(notice) => {
                  backToLogin(notice ?? null);
                }}
                onNeedsEmailVerification={(email) =>
                  openVerifyEmail(
                    email,
                    "Account created. Enter the verification code from your email.",
                  )
                }
              />
            )}
            {view === "forgot" && (
              <ForgotPasswordPage onBackToLogin={() => backToLogin()} />
            )}
            {view === "otp" && (
              <OtpLoginPage onBackToLogin={() => backToLogin()} />
            )}
            {view === "reset-link" && (
              <ResetPasswordLinkPage
                onDone={() =>
                  backToLogin("Password updated. Sign in with your new password.")
                }
              />
            )}
            {view === "verify-email" && (
              <VerifyEmailPage
                initialEmail={verifyEmail}
                onBackToLogin={() => backToLogin()}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
