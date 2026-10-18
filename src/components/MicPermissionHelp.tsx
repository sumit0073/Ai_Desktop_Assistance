import { open as openUrl } from "@tauri-apps/plugin-shell";
import { isMacBuild, microphoneSettingsUrl } from "../lib/platform";

// Mac DMG and Windows EXE/MSI are separate builds (TAURI_ENV_PLATFORM).

async function openMicSettings() {
  try {
    await openUrl(microphoneSettingsUrl());
  } catch {
    // User can follow the numbered steps manually.
  }
}

function MicSettingsButton() {
  return (
    <button
      type="button"
      className="start-button start-mic-denied__cta"
      onClick={() => void openMicSettings()}
    >
      Open mic settings
    </button>
  );
}

/** macOS-only copy — shipped in DMG builds; not shown on Windows installers. */
function MacMicPermissionHelp() {
  return (
    <div className="start-mic-denied" role="alert">
      <p className="start-mic-denied__title">
        Microphone is blocked for System Bunny
      </p>
      <ol className="start-mic-denied__steps">
        <li>
          Click <strong>Open mic settings</strong> below (opens Mac{" "}
          <strong>System Settings</strong>).
        </li>
        <li>
          Go to <strong>Privacy &amp; Security</strong> →{" "}
          <strong>Microphone</strong>.
        </li>
        <li>
          Turn <strong>on</strong> the switch next to{" "}
          <strong>System Bunny</strong>.
        </li>
        <li>
          Return here and tap <strong>Check mic</strong> again.
        </li>
      </ol>
      <p className="start-mic-denied__note">
        If System Bunny is not in the Microphone list, quit the app, reopen it,
        tap Check mic once so macOS can register it, then check the list again.
      </p>
      <MicSettingsButton />
    </div>
  );
}

/** Windows-only copy — shipped in EXE/MSI builds; not shown on Mac DMGs. */
function WindowsMicPermissionHelp() {
  return (
    <div className="start-mic-denied" role="alert">
      <p className="start-mic-denied__title">
        Microphone is blocked for System Bunny
      </p>
      <ol className="start-mic-denied__steps">
        <li>
          Click <strong>Open mic settings</strong> below (opens Windows{" "}
          <strong>Settings</strong>).
        </li>
        <li>
          Go to <strong>Privacy &amp; security</strong> →{" "}
          <strong>Microphone</strong>.
        </li>
        <li>
          Turn on microphone access. If you see{" "}
          <strong>Let desktop apps access your microphone</strong>, turn that
          on too.
        </li>
        <li>
          Return here and tap <strong>Check mic</strong> again.
        </li>
      </ol>
      <MicSettingsButton />
    </div>
  );
}

/**
 * OS-specific mic denial help for this install.
 * Mac DMG → Mac steps only. Windows EXE/MSI → Windows steps only.
 */
export function MicPermissionHelp() {
  // Mac DMG → Mac steps only. Windows EXE/MSI → Windows steps only.
  if (isMacBuild()) {
    return <MacMicPermissionHelp />;
  }
  return <WindowsMicPermissionHelp />;
}
