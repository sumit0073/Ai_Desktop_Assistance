import { useState } from "react";
import { LoginPage } from "../pages/LoginPage";
import { SignupPage } from "../pages/SignupPage";
import { AuthTabs } from "./AuthTabs";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";

type AuthView = "login" | "signup";

export function LandingPage() {
  const [view, setView] = useState<AuthView>("login");

  const switchView = (next: AuthView) => {
    if (next === view) return;
    setView(next);
  };

  return (
    <div className={`shell landing landing--${view}`}>
      <header className="topbar" data-tauri-drag-region>
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-mark__glyph">S</span>
        </div>
        <div className="topbar__actions">
          <ThemeToggle />
          <WindowControls />
        </div>
      </header>

      <main className="landing__content">
        <section className="hero-copy">
          <p className="eyebrow">Desktop overlay</p>
          <h1 className="brand-title">Seecog</h1>
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
              <LoginPage />
            ) : (
              <SignupPage onSwitchToLogin={() => switchView("login")} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
