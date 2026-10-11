/**
 * The Evolution/WhatsApp instance this build talks to.
 *
 * Controlled entirely by `EXPO_PUBLIC_BIMI_INSTANCE`, which Expo inlines at
 * bundle time — so it must be set in `.env.local` for local dev *and* in the
 * matching `eas.json` build profile, otherwise released builds fall back to
 * DEFAULT_INSTANCE.
 *
 * This deliberately does not fall back to "whatever instance the database has
 * contacts for": that picked the alphabetically-first instance and silently
 * showed messages from a stale one.
 */
const DEFAULT_INSTANCE = 'main';

export const INSTANCE = process.env.EXPO_PUBLIC_BIMI_INSTANCE || DEFAULT_INSTANCE;

export function useInstance(): string {
  return INSTANCE;
}
