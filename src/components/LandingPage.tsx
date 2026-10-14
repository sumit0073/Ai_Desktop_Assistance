import { useState } from "react";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { OtpLoginPage } from "../pages/OtpLoginPage";
import { SignupPage } from "../pages/SignupPage";
import { AuthTabs } from "./AuthTabs";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import bunnyLogo from "../assets/system-bunny-logo.png";

type AuthView = "login" | "signup" | "forgot" | "otp";

export function LandingPage() {
  const [view, setView] = useState<AuthView>("login");
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const switchView = (next: AuthView) => {
    if (next === view) return;
    if (next === "signup" || next === "forgot" || next === "otp") {
      setAuthNotice(null);
    }
    setView(next);
  };

  const backToLogin = (notice?: string | null) => {
    setAuthNotice(notice ?? null);
    setView("login");
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
            <p className="tagline">Reset your password and get back to work.</p>
          )}
          {view === "otp" && (
            <p className="tagline">
              Sign in with a one-time code sent to your email or phone.
            </p>
          )}
        </section>

        <div className="auth-panel">
          {showTabs && (
            <AuthTabs
              active={view}
              onChange={(next) => switchView(next)}
            />
          )}
          <div key={view} className="auth-panel__body">
            {view === "login" && (
              <LoginPage
                notice={authNotice}
                onForgotPassword={() => switchView("forgot")}
                onOtpLogin={() => switchView("otp")}
              />
            )}
            {view === "signup" && (
              <SignupPage
                onSwitchToLogin={(notice) => {
                  backToLogin(notice ?? null);
                }}
              />
            )}
            {view === "forgot" && (
              <ForgotPasswordPage onBackToLogin={backToLogin} />
            )}
            {view === "otp" && (
              <OtpLoginPage onBackToLogin={() => backToLogin()} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
