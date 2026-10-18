import { useCallback, useEffect, useRef, useState } from "react";
import { MicLevelMeter } from "./MicLevelMeter";
import { MicPermissionHelp } from "./MicPermissionHelp";
import { ProfileMenu } from "./ProfileMenu";
import { StartInAppModal } from "./StartInAppModal";
import { ThemeToggle } from "./ThemeToggle";
import { WindowControls } from "./WindowControls";
import { useAuth } from "../context/AuthContext";
import { useWorkSession } from "../context/WorkSessionContext";
import { useMicInputLevel } from "../hooks/useMicInputLevel";
import {
  appShortcutPlatformLabel,
  getAppShortcutRows,
} from "../lib/appShortcuts";
import {
  listEndedAppSessions,
  type AppSessionRow,
} from "../lib/appSessions";
import { isMacBuild } from "../lib/platform";
import {
  formatSessionDate,
  formatSessionDuration,
  formatSessionStartTime,
} from "../lib/formatSessionHistory";
import bunnyLogo from "../assets/system-bunny-logo.png";

type HubPanel = "mic" | "shortcuts" | "history" | null;

type MicCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; deviceLabel: string }
  | { status: "denied" }
  | { status: "error"; message: string };

function stopMicStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

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

type MicOpenResult =
  | { ok: true; deviceLabel: string; stream: MediaStream }
  | { ok: false; state: Exclude<MicCheckState, { status: "ok" }> };

async function openMicForCheck(): Promise<MicOpenResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "This environment cannot access the microphone.",
      },
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    const deviceLabel = track?.label?.trim() || "Default microphone";
    return { ok: true, deviceLabel, stream };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { ok: false, state: { status: "denied" } };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return {
        ok: false,
        state: {
          status: "error",
          message: "No microphone was found on this device.",
        },
      };
    }
    return {
      ok: false,
      state: {
        status: "error",
        message: isMacBuild()
          ? "Could not open the microphone. Allow System Bunny in Mac System Settings → Privacy & Security → Microphone."
          : "Could not open the microphone. Allow access in Windows Settings → Privacy & security → Microphone.",
      },
    };
  }
}

export function StartScreen() {
  const { user } = useAuth();
  const { startSession } = useWorkSession();
  const [panel, setPanel] = useState<HubPanel>(null);
  const [mic, setMic] = useState<MicCheckState>({ status: "idle" });
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const [historyRows, setHistoryRows] = useState<AppSessionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const micLevel = useMicInputLevel(micStream);

  const isMac = isMacBuild();
  const shortcutRows = getAppShortcutRows(isMac);
  const platformLabel = appShortcutPlatformLabel(isMac);

  const firstName = firstNameFromUser(
    user?.user_metadata?.full_name as string | undefined,
    user?.email,
  );

  const releaseMicStream = useCallback(() => {
    stopMicStream(micStreamRef.current);
    micStreamRef.current = null;
    setMicStream(null);
  }, []);

  const closePanel = useCallback(() => {
    releaseMicStream();
    setMic({ status: "idle" });
    setPanel(null);
  }, [releaseMicStream]);

  const startMicCheck = useCallback(async () => {
    releaseMicStream();
    setMic({ status: "checking" });
    const result = await openMicForCheck();
    if (!result.ok) {
      setMic(result.state);
      return;
    }
    micStreamRef.current = result.stream;
    setMicStream(result.stream);
    setMic({ status: "ok", deviceLabel: result.deviceLabel });
  }, [releaseMicStream]);

  const openMic = () => {
    setPanel("mic");
    void startMicCheck();
  };

  const openShortcuts = () => setPanel("shortcuts");

  const openHistory = () => {
    setPanel("history");
    setHistoryError(null);
  };

  useEffect(() => {
    if (panel !== "history" || !user) return;

    let cancelled = false;
    setHistoryLoading(true);
    void listEndedAppSessions(user.id)
      .then((rows) => {
        if (!cancelled) {
          setHistoryRows(rows);
          setHistoryLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryError("Could not load session history.");
          setHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [panel, user]);

  useEffect(() => {
    if (panel === "mic") return;
    releaseMicStream();
  }, [panel, releaseMicStream]);

  useEffect(() => {
    return () => stopMicStream(micStreamRef.current);
  }, []);

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
          Start a focus session and get into your flow.
        </p>

        <button
          type="button"
          className="start-button"
          onClick={() => void startSession()}
          title="Begin session"
        >
          <span className="start-button__copy">
            <span className="start-button__label">Start</span>
            <span className="start-button__hint">Begin session</span>
          </span>
          <span className="start-button__go" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                d="M9 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>

        <div className="start-hub-actions" role="group" aria-label="Start tools">
          <button
            type="button"
            className="start-hub-chip"
            onClick={openMic}
            title="Check microphone"
          >
            <svg className="start-hub-chip__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M7 11a5 5 0 0 0 10 0M12 16v3M9 19h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            Check mic
          </button>
          <button
            type="button"
            className="start-hub-chip"
            onClick={openShortcuts}
            title="Keyboard shortcuts"
          >
            <svg className="start-hub-chip__icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect
                x="3"
                y="6"
                width="18"
                height="12"
                rx="2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            Shortcuts
          </button>
        </div>

        <button
          type="button"
          className="start-hub-history"
          onClick={openHistory}
          title="Session history"
        >
          <svg className="start-hub-chip__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 7v5l3 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 5.5V8.8h3.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          History
        </button>
      </main>

      <ProfileMenu placement="corner" className="start-screen__profile" />

      {panel === "mic" && (
        <StartInAppModal title="Check microphone" onClose={closePanel}>
          <p className="start-modal__lead">
            Speak to confirm the mic works. This does not begin recording.
          </p>
          {mic.status === "checking" && (
            <p className="start-modal__muted">Opening microphone…</p>
          )}
          {mic.status === "ok" && (
            <div className="start-mic-check" role="status">
              <p className="start-modal__ok start-mic-check__label">
                Microphone ready: <strong>{mic.deviceLabel}</strong>
              </p>
              <MicLevelMeter
                level={micLevel.level}
                band={micLevel.band}
                label="Microphone input strength"
              />
              <p className="start-mic-check__hint">
                Speak to test — yellow soft, green clear, red too loud.
              </p>
            </div>
          )}
          {mic.status === "denied" && <MicPermissionHelp />}
          {mic.status === "error" && (
            <p className="start-modal__warn" role="alert">
              {mic.message}
            </p>
          )}
        </StartInAppModal>
      )}

      {panel === "shortcuts" && (
        <StartInAppModal
          title={`${platformLabel} shortcuts`}
          onClose={closePanel}
        >
          <p className="start-modal__lead">
            Shortcuts for this {platformLabel} build. Use Shift+↑ / Shift+↓ to
            scroll this list.
          </p>
          <ul className="start-shortcut-list start-modal__scroll">
            {shortcutRows.map((row) => (
              <li key={row.keys} className="start-shortcut-list__row">
                <kbd className="start-shortcut-list__keys">{row.keys}</kbd>
                <span className="start-shortcut-list__action">{row.action}</span>
              </li>
            ))}
          </ul>
        </StartInAppModal>
      )}

      {panel === "history" && (
        <StartInAppModal title="Session history" onClose={closePanel}>
          {historyLoading && (
            <p className="start-modal__muted">Loading sessions…</p>
          )}
          {historyError && (
            <p className="start-modal__warn" role="alert">
              {historyError}
            </p>
          )}
          {!historyLoading && !historyError && historyRows.length === 0 && (
            <p className="start-modal__muted">
              No finished sessions yet. Start a focus session, then end it to
              see it here.
            </p>
          )}
          {!historyLoading && historyRows.length > 0 && (
            <div className="start-history">
              <div className="start-history__head" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Started</span>
                <span role="columnheader">Duration</span>
              </div>
              <div
                className="start-history__rows start-modal__scroll"
                role="rowgroup"
              >
                {historyRows.map((row) => (
                  <div className="start-history__row" role="row" key={row.id}>
                    <span>{formatSessionDate(row.started_at)}</span>
                    <span>{formatSessionStartTime(row.started_at)}</span>
                    <span>
                      {formatSessionDuration(row.started_at, row.ended_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </StartInAppModal>
      )}
    </div>
  );
}
