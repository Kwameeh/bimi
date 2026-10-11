/**
 * Native no-op. The web build gets the real implementation from
 * `voice-hotkey.web.tsx` (same platform-split pattern as `app-tabs.*`).
 * On a phone there is no keyboard to listen to — voice mode is opened from
 * the mic button in the Assistant composer instead.
 */
export function VoiceHotkey() {
  return null;
}
