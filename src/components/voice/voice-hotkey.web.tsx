import { router, usePathname } from 'expo-router';
import { useEffect } from 'react';

/**
 * Ctrl/⌘+K opens voice mode on the web build.
 *
 * This only fires while the Bimi tab has focus — a browser page cannot claim
 * an OS-global shortcut. Mounted once from the root layout.
 */
export function VoiceHotkey() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'k' && event.key !== 'K') return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (pathname === '/voice') {
        router.back();
      } else {
        router.push('/voice');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname]);

  return null;
}
