import { ProfileMenu } from "./ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import { useAuth } from "../context/AuthContext";
import { useWorkSession } from "../context/WorkSessionContext";

export function StartScreen() {
  const { user } = useAuth();
  const { startSession } = useWorkSession();

  const name =
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "there";

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

        <button
          type="button"
          className="start-button"
          onClick={() => void startSession()}
          title="Begin session"
        >
          <span className="start-button__label">Start</span>
          <span className="start-button__hint">Begin session</span>
        </button>
      </main>
    </div>
  );
}
