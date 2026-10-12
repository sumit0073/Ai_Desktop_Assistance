import { ProfileMenu } from "./ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import { useAuth } from "../context/AuthContext";
import { useWorkSession } from "../context/WorkSessionContext";
import bunnyLogo from "../assets/system-bunny-logo.png";

function firstNameFromUser(
  fullName: string | undefined,
  email: string | undefined,
): string {
  const fromMeta = fullName?.trim().split(/\s+/)[0];
  if (fromMeta) {
    return fromMeta.charAt(0).toUpperCase() + fromMeta.slice(1);
  }
  const fromEmail = email?.split("@")[0]?.trim();
  if (fromEmail) {
    return fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1);
  }
  return "there";
}

export function StartScreen() {
  const { user } = useAuth();
  const { startSession } = useWorkSession();

  const firstName = firstNameFromUser(
    user?.user_metadata?.full_name as string | undefined,
    user?.email,
  );

  return (
    <div className="shell start-screen">
      <header className="topbar" data-tauri-drag-region>
        <div className="topbar__spacer" aria-hidden="true" />
        <div className="topbar__actions">
          <ThemeToggle />
          <WindowControls />
        </div>
      </header>

      <main className="start-screen__content">
        <div className="start-logo" aria-hidden="true">
          <img
            className="start-logo__img"
            src={bunnyLogo}
            alt=""
            draggable={false}
          />
        </div>

        <p className="eyebrow">Ready when you are</p>
        <h1 className="start-greeting">
          <span className="start-greeting__hi">Hi,</span>
          <span className="start-greeting__name">{firstName}</span>
        </h1>
        <p className="tagline">
          Start a focus session to open chat. Use Ctrl/⌘+Shift+A to hide or show
          the overlay. Close quits the app.
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

      <ProfileMenu placement="corner" className="start-screen__profile" />
    </div>
  );
}
