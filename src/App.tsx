import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LandingPage } from "./components/LandingPage";
import { StartScreen } from "./components/StartScreen";
import { ChatInterface } from "./components/ChatInterface";
import { useAuth } from "./context/AuthContext";
import { useWorkSession } from "./context/WorkSessionContext";
import {
  useShortcutBridge,
  type ShortcutEvent,
} from "./hooks/useGlobalShortcuts";
import { isEmailVerified } from "./lib/emailVerification";
import "./App.css";

function App() {
  const { user, loading } = useAuth();
  const { active, startSession } = useWorkSession();
  const emailVerified = isEmailVerified(user);

  useShortcutBridge();

  useEffect(() => {
    invoke("enable_content_protection").catch(() => {
      // Running in browser preview without Tauri — ignore.
    });
  }, []);

  // Logged in but idle: auto-start session when a capture/ask/record shortcut fires.
  useEffect(() => {
    if (!user || !emailVerified || active) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<ShortcutEvent>("seecog://shortcut", (event) => {
      if (
        event.payload.action === "screenshot-analyze" ||
        event.payload.action === "analyze-chat" ||
        event.payload.action === "toggle-record"
      ) {
        void startSession();
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [user, emailVerified, active, startSession]);

  if (loading) {
    return (
      <div className="app-root">
        <div className="floating-card loading-card">
          <div className="loader" aria-label="Loading" />
        </div>
      </div>
    );
  }

  let body = <LandingPage />;
  if (user && !emailVerified) {
    body = <LandingPage forceVerifyEmail={user.email ?? ""} />;
  } else if (user && !active) {
    body = <StartScreen />;
  } else if (user && active) {
    body = <ChatInterface />;
  }

  const sessionActive = Boolean(user && emailVerified && active);

  return (
    <div className={`app-root ${sessionActive ? "session-active" : ""}`}>
      <div className={`floating-card ${sessionActive ? "floating-card--glass" : ""}`}>
        {body}
      </div>
    </div>
  );
}

export default App;
