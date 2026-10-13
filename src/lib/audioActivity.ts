/**
 * True when the browser reports the mic track as hardware/OS muted
 * (mute hotkey). Do not treat "no recent peak" as mute — level meters
 * often read 0 in WebView even while speech is present.
 */
export function isMicHardwareMuted(stream: MediaStream | null): boolean {
  if (!stream) return true;
  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) return true;
  return tracks.every((t) => !t.enabled || t.muted || t.readyState !== "live");
}
