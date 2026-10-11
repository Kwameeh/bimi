import { describe, expect, it } from 'vitest';
import { formatChatTimestamp, formatDateSeparator, formatMessageTime, initialsFor } from './format';

describe('format utilities', () => {
  describe('initialsFor', () => {
    it('returns question mark for falsy or empty names', () => {
      expect(initialsFor(undefined)).toBe('?');
      expect(initialsFor(null)).toBe('?');
      expect(initialsFor('')).toBe('?');
      expect(initialsFor('   ')).toBe('?');
    });

    it('extracts two letters from a single word name', () => {
      expect(initialsFor('Kwame')).toBe('KW');
      expect(initialsFor('Al')).toBe('AL');
    });

    it('extracts first and last initials for multi-word names', () => {
      expect(initialsFor('Kwame Mensah')).toBe('KM');
      expect(initialsFor('Jane Doe Smith')).toBe('JS');
      expect(initialsFor('  Sarah   Connor  ')).toBe('SC');
    });
  });

  describe('formatMessageTime', () => {
    it('returns empty string for undefined input', () => {
      expect(formatMessageTime(undefined)).toBe('');
    });

    it('formats valid timestamp in HH:mm format', () => {
      // 2026-06-15T14:30:00Z -> 1771079400 seconds
      const testDate = new Date(2026, 5, 15, 14, 30, 0);
      const seconds = Math.floor(testDate.getTime() / 1000);
      expect(formatMessageTime(seconds)).toBe('14:30');
    });

    it('handles millisecond timestamps gracefully without exploding', () => {
      const testDate = new Date(2026, 5, 15, 9, 15, 0);
      const ms = testDate.getTime();
      expect(formatMessageTime(ms)).toBe('09:15');
    });
  });

  describe('formatChatTimestamp', () => {
    it('returns empty string for undefined input', () => {
      expect(formatChatTimestamp(undefined)).toBe('');
    });

    it('returns time for messages sent today', () => {
      const now = new Date();
      now.setHours(10, 25, 0, 0);
      const seconds = Math.floor(now.getTime() / 1000);
      expect(formatChatTimestamp(seconds)).toBe('10:25');
    });

    it('returns "Yesterday" for messages sent yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);
      const seconds = Math.floor(yesterday.getTime() / 1000);
      expect(formatChatTimestamp(seconds)).toBe('Yesterday');
    });
  });

  describe('formatDateSeparator', () => {
    it('returns empty string for undefined input', () => {
      expect(formatDateSeparator(undefined)).toBe('');
    });

    it('returns "Today" for current date', () => {
      const now = new Date();
      const seconds = Math.floor(now.getTime() / 1000);
      expect(formatDateSeparator(seconds)).toBe('Today');
    });

    it('returns "Yesterday" for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const seconds = Math.floor(yesterday.getTime() / 1000);
      expect(formatDateSeparator(seconds)).toBe('Yesterday');
    });
  });
});
