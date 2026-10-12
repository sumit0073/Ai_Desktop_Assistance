import { useState } from "react";
import { LoginPage } from "../pages/LoginPage";
import { SignupPage } from "../pages/SignupPage";
import { AuthTabs } from "./AuthTabs";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import bunnyLogo from "../assets/system-bunny-logo.png";

type AuthView = "login" | "signup";

export function LandingPage() {
  const [view, setView] = useState<AuthView>("login");
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const switchView = (next: AuthView) => {
    if (next === view) return;
    if (next === "signup") setAuthNotice(null);
    setView(next);
  };

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
        </section>

        <div className="auth-panel">
          <AuthTabs active={view} onChange={switchView} />
          <div key={view} className="auth-panel__body">
            {view === "login" ? (
              <LoginPage notice={authNotice} />
            ) : (
              <SignupPage
                onSwitchToLogin={(notice) => {
                  setAuthNotice(notice ?? null);
                  switchView("login");
                }}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
