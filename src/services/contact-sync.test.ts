import { describe, expect, it, vi } from 'vitest';
import { normalizePhone } from './contact-sync';

vi.mock('expo-contacts/legacy', () => ({
  Fields: { ID: 'id', Name: 'name', PhoneNumbers: 'phoneNumbers' },
  ContactTypes: { Person: 'person' },
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getContactsAsync: vi.fn(),
  addContactAsync: vi.fn(),
  addContactsChangeListener: vi.fn(),
}));

describe('contact-sync service', () => {
  describe('normalizePhone', () => {
    it('returns undefined for falsy or empty inputs', () => {
      expect(normalizePhone(undefined)).toBeUndefined();
      expect(normalizePhone(null)).toBeUndefined();
      expect(normalizePhone('')).toBeUndefined();
    });

    it('strips all non-digit characters from telephone numbers', () => {
      expect(normalizePhone('+1 (555) 123-4567')).toBe('15551234567');
      expect(normalizePhone('+44 20 7946 0991')).toBe('442079460991');
      expect(normalizePhone('024-123-4567')).toBe('0241234567');
    });

    it('rejects numbers with fewer than 7 digits', () => {
      expect(normalizePhone('12345')).toBeUndefined();
      expect(normalizePhone('123-456')).toBeUndefined();
    });

    it('accepts numbers with 7 or more digits', () => {
      expect(normalizePhone('1234567')).toBe('1234567');
      expect(normalizePhone('+233 24 123 4567')).toBe('233241234567');
    });
  });
});
