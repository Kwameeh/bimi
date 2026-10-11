import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

export type CalendarResult = { eventId: string } | { error: string };

export async function addMeetingToCalendar(args: {
  title: string;
  startAt: number;
  durationMinutes?: number;
  notes?: string;
}): Promise<CalendarResult> {
  if (Platform.OS === 'web') {
    return { error: 'Calendar is not supported on web.' };
  }

  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== 'granted') {
      return { error: 'Calendar permission was denied.' };
    }

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.filter((c) => c.allowsModifications && c.source !== undefined);
    if (writable.length === 0) {
      return { error: 'No writable calendar found on this device.' };
    }
    const primary =
      writable.find((c) => c.isPrimary) ??
      writable.find((c) => c.source?.name?.toLowerCase().includes('google')) ??
      writable[0];

    const startDate = new Date(args.startAt);
    const durationMs = (args.durationMinutes ?? 30) * 60 * 1000;
    const endDate = new Date(args.startAt + durationMs);

    const eventId = await Calendar.createEventAsync(primary.id, {
      title: args.title,
      startDate,
      endDate,
      notes: args.notes,
      timeZone: undefined,
    });

    return { eventId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
