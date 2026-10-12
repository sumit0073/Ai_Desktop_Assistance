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
import "./App.css";

function App() {
  const { user, loading, enterDemo, configured, emailVerified } = useAuth();
  const { active, startSession } = useWorkSession();

  useShortcutBridge();

  useEffect(() => {
    invoke("enable_content_protection").catch(() => {
      // Running in browser preview without Tauri — ignore.
    });
  }, []);

  // Before login: demo shortcut opens auth home (demo user → start screen).
  useEffect(() => {
    if (user || configured) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<ShortcutEvent>("seecog://shortcut", (event) => {
      if (
        event.payload.action === "screenshot-analyze" ||
        event.payload.action === "analyze-chat"
      ) {
        enterDemo();
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
  }, [user, configured, enterDemo]);

  // Logged in but idle: auto-start session when a capture/ask shortcut fires.
  useEffect(() => {
    if (!user || active || !emailVerified) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<ShortcutEvent>("seecog://shortcut", (event) => {
      if (
        event.payload.action === "screenshot-analyze" ||
        event.payload.action === "analyze-chat"
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
  }, [user, active, emailVerified, startSession]);

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
  if (user && !active) body = <StartScreen />;
  if (user && active) body = <ChatInterface />;

  const sessionActive = Boolean(user && active);

  return (
    <div className={`app-root ${sessionActive ? "session-active" : ""}`}>
      <div className={`floating-card ${sessionActive ? "floating-card--glass" : ""}`}>
        {body}
      </div>
    </div>
  );
}

export default App;
