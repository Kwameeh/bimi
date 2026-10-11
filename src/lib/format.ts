import { format, isThisWeek, isToday, isYesterday } from 'date-fns';

function toDate(secondsOrMs: number | undefined): Date | null {
  if (secondsOrMs === undefined) return null;
  // Backend stores seconds (Unix timestamp); guard against accidental ms.
  const ms = secondsOrMs > 1e12 ? secondsOrMs : secondsOrMs * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function formatChatTimestamp(seconds: number | undefined): string {
  const d = toDate(seconds);
  if (!d) return '';
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, 'EEE');
  return format(d, 'dd/MM/yy');
}

export function formatMessageTime(seconds: number | undefined): string {
  const d = toDate(seconds);
  if (!d) return '';
  return format(d, 'HH:mm');
}

export function formatDateSeparator(seconds: number | undefined): string {
  const d = toDate(seconds);
  if (!d) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  if (isThisWeek(d, { weekStartsOn: 1 })) return format(d, 'EEEE');
  return format(d, 'd MMM yyyy');
}

export function initialsFor(name: string | undefined | null): string {
  if (!name) return '?';
  const cleaned = name.trim();
  if (cleaned.length === 0) return '?';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
