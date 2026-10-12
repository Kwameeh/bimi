/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { areTasksDuplicate, normalizeTaskTitle } from './tasks';

const modules = import.meta.glob('./**/*.ts');

const INSTANCE = 'test-instance';

type Ctx = ReturnType<typeof convexTest>;
let active: Ctx | null = null;

function setup(): Ctx {
  active = convexTest(schema, modules);
  return active;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  if (active) {
    await active.finishAllScheduledFunctions(vi.runAllTimers);
    active = null;
  }
  vi.useRealTimers();
});

describe('Task Deduplication Engine', () => {
  describe('Helper functions', () => {
    it('normalizes task titles by stripping stopwords and punctuation', () => {
      const title1 = 'Please remember to submit the report by Friday!';
      const title2 = 'Submit report by Friday';
      expect(normalizeTaskTitle(title1)).toBe('submit report friday');
      expect(normalizeTaskTitle(title2)).toBe('submit report friday');
    });

    it('identifies exact and fuzzy duplicate tasks', () => {
      expect(
        areTasksDuplicate(
          { title: 'Submit quarterly report' },
          { title: 'Please remember to submit quarterly report' },
        ),
      ).toBe(true);

      expect(areTasksDuplicate({ title: 'Buy milk' }, { title: 'Send quarterly report' })).toBe(
        false,
      );
    });

    it('considers dueAt timestamps when matching tasks', () => {
      const now = Date.now();
      const inOneHour = now + 60 * 60 * 1000;
      const inThreeDays = now + 3 * 24 * 60 * 60 * 1000;

      // Close due dates match
      expect(
        areTasksDuplicate(
          { title: 'Review PR', dueAt: now },
          { title: 'Please review PR', dueAt: inOneHour },
        ),
      ).toBe(true);

      // Distant due dates do not match
      expect(
        areTasksDuplicate(
          { title: 'Review PR', dueAt: now },
          { title: 'Review PR', dueAt: inThreeDays },
        ),
      ).toBe(false);
    });
  });

  describe('Convex mutation deduplication', () => {
    it('consolidates duplicate tasks from multiple groups into a single task with increased mentionCount', async () => {
      const t = setup();

      const contactGroupA = (await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          instance: INSTANCE,
          remoteJid: 'group-a@g.us',
          displayName: 'Engineering Group',
        });
      })) as Id<'contacts'>;

      const contactGroupB = (await t.run(async (ctx) => {
        return await ctx.db.insert('contacts', {
          instance: INSTANCE,
          remoteJid: 'group-b@g.us',
          displayName: 'All Hands Group',
        });
      })) as Id<'contacts'>;

      // Task 1 created from Group A
      const id1 = await t.mutation(internal.tasks.createInternal, {
        instance: INSTANCE,
        contactId: contactGroupA,
        title: 'Submit timesheets by 5pm',
        priority: 'normal',
      });

      // Task 2 created from Group B (near-duplicate)
      const id2 = await t.mutation(internal.tasks.createInternal, {
        instance: INSTANCE,
        contactId: contactGroupB,
        title: 'Reminder: Please submit timesheets by 5pm',
        priority: 'urgent',
      });

      // Must return the SAME task ID
      expect(id1).toBe(id2);

      // Verify task fields were consolidated
      const tasks = await t.query(api.tasks.list, { instance: INSTANCE });
      expect(tasks).toHaveLength(1);

      const task = tasks[0];
      expect(task.title).toBe('Submit timesheets by 5pm');
      expect(task.mentionCount).toBe(2);
      expect(task.priority).toBe('urgent'); // Elevated from normal to urgent
      expect(task.sourceContactIds).toContain(contactGroupA);
      expect(task.sourceContactIds).toContain(contactGroupB);
    });

    it('merges existing backlog duplicates with mergeDuplicates mutation', async () => {
      const t = setup();

      // Seed duplicates directly in the database (simulating legacy data)
      await t.run(async (ctx) => {
        await ctx.db.insert('tasks', {
          instance: INSTANCE,
          title: 'Fill out annual survey',
          status: 'open',
          createdBy: 'ai',
          priority: 'normal',
        });
        await ctx.db.insert('tasks', {
          instance: INSTANCE,
          title: 'Please fill out annual survey',
          status: 'open',
          createdBy: 'ai',
          priority: 'high',
        });
        await ctx.db.insert('tasks', {
          instance: INSTANCE,
          title: 'Organize team lunch',
          status: 'open',
          createdBy: 'user',
        });
      });

      const initialTasks = await t.query(api.tasks.list, { instance: INSTANCE });
      expect(initialTasks).toHaveLength(3);

      const mergeResult = await t.mutation(api.tasks.mergeDuplicates, { instance: INSTANCE });
      expect(mergeResult.mergedCount).toBe(1);
      expect(mergeResult.remainingCount).toBe(2);

      const remainingTasks = await t.query(api.tasks.list, { instance: INSTANCE });
      expect(remainingTasks).toHaveLength(2);

      const surveyTask = remainingTasks.find((x) => x.title.includes('annual survey'));
      expect(surveyTask).toBeDefined();
      expect(surveyTask?.mentionCount).toBe(2);
      expect(surveyTask?.priority).toBe('high');
    });
  });
});
