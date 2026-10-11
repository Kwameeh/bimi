// Shared date-grounding helper for LLM prompts.
//
// Models can only resolve relative dates ("tomorrow at 5pm", "this Friday")
// correctly when they know the user's local weekday, date, time, and UTC
// offset. A bare UTC ISO string gives them none of that, so extracted dueAt
// values land on the wrong day for any non-UTC user.

/**
 * Formats "now" for a prompt, e.g.
 * `Wednesday, 2026-06-04 17:30 GMT+01:00 (Africa/Lagos)`.
 *
 * Pass `userPreferences.quietHoursTimezone`; falls back to UTC when the
 * timezone is missing or invalid.
 */
export function formatDateContext(timezone?: string | null): string {
  const now = new Date();
  let tz = timezone && timezone.trim().length > 0 ? timezone.trim() : "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = dateParts(now, tz);
  } catch {
    tz = "UTC";
    parts = dateParts(now, tz);
  }
  const get = (type: Intl.DateTimeFormatPart["type"]) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const offset = get("timeZoneName"); // e.g. "GMT+01:00"
  return `${get("weekday")}, ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${offset} (${tz})`;
}

function dateParts(now: Date, tz: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);
}

/**
 * Appended to prompts that extract ISO datetimes so `new Date(iso)` parses
 * them into the correct instant.
 */
export const ISO_OFFSET_NOTE =
  "When outputting an ISO datetime, include the UTC offset shown above (e.g. 2026-06-05T17:00:00+01:00).";
