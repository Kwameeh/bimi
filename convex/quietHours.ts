import type { Doc } from "./_generated/dataModel";

export type QuietHoursPrefs = {
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezone?: string;
  quietHoursAllowVip?: boolean;
};

function parseHHmm(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Get the current local hour-minute (0..1439) in the given IANA timezone.
 * Falls back to UTC when tz is missing/invalid. Uses Intl.DateTimeFormat which
 * is available in V8 (Convex runtime).
 */
function localMinutes(nowMs: number, tz: string | undefined | null): number {
  const date = new Date(nowMs);
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz && tz.length > 0 ? tz : "UTC",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = fmt.formatToParts(date);
    let h = 0;
    let m = 0;
    for (const p of parts) {
      if (p.type === "hour") h = Number(p.value);
      else if (p.type === "minute") m = Number(p.value);
    }
    // Intl can render "24" for midnight in some locales — normalise to 0.
    if (h === 24) h = 0;
    return h * 60 + m;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

export function isInQuietHoursNow(
  prefs: QuietHoursPrefs | null | undefined,
  nowMs: number = Date.now(),
): { active: boolean } {
  if (!prefs || prefs.quietHoursEnabled !== true) return { active: false };
  const start = parseHHmm(prefs.quietHoursStart);
  const end = parseHHmm(prefs.quietHoursEnd);
  if (start === null || end === null) return { active: false };
  if (start === end) return { active: false };

  const cur = localMinutes(nowMs, prefs.quietHoursTimezone);

  // Wrap-over-midnight window (e.g. 22:00 → 07:00) vs same-day window.
  const active =
    start < end
      ? cur >= start && cur < end
      : cur >= start || cur < end;
  return { active };
}

export function contactBypassesQuietHours(
  contact: Pick<Doc<"contacts">, "priority" | "relationship"> | null | undefined,
  prefs: QuietHoursPrefs | null | undefined,
): boolean {
  if (!contact) return false;
  if (prefs?.quietHoursAllowVip !== true) return false;
  if (contact.priority === "urgent") return true;
  if (contact.relationship === "vip") return true;
  return false;
}
