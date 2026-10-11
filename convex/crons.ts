import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.cron('daily summary', '0 7 * * *', internal.summaries.generateDailySummaryAll, {});

crons.cron('check-in scan', '0 9 * * *', internal.checkins.scanForCheckInsInternal, {});

crons.cron('memory expiry sweep', '30 3 * * *', internal.memories.sweepExpiredInternal, {});

crons.interval(
  'contact memory profiles',
  { hours: 1 },
  internal.contactMemory.processDueProfilesInternal,
  {},
);

crons.interval('contact goals', { hours: 1 }, internal.contactGoals.runDueGoalsInternal, {});

// Profile-picture URLs from WhatsApp are signed and rotate, so cached ones are
// re-verified on a rolling basis rather than trusted indefinitely.
crons.interval('avatar refresh', { hours: 6 }, internal.contacts.sweepAvatarsInternal, {});

export default crons;
