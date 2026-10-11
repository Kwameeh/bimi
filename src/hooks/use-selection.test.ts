import { describe, expect, it, vi } from 'vitest';
import { BULK_DELETE_LIMIT, deleteInChunks } from './use-selection';

describe('use-selection', () => {
  describe('deleteInChunks', () => {
    it('handles empty ids without calling the batch handler', async () => {
      const mockRemove = vi.fn().mockResolvedValue({ deleted: 0, missing: 0 });
      const count = await deleteInChunks([], mockRemove);

      expect(count).toBe(0);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('processes small batches within a single chunk', async () => {
      const mockRemove = vi.fn().mockResolvedValue({ deleted: 3, missing: 0 });
      const ids = ['id-1', 'id-2', 'id-3'];

      const count = await deleteInChunks(ids, mockRemove);

      expect(count).toBe(3);
      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith(['id-1', 'id-2', 'id-3']);
    });

    it('chunks large lists respecting BULK_DELETE_LIMIT', async () => {
      const totalItems = BULK_DELETE_LIMIT * 2 + 15;
      const ids = Array.from({ length: totalItems }, (_, i) => `item-${i}`);

      const mockRemove = vi.fn().mockImplementation((batch: string[]) => {
        return Promise.resolve({ deleted: batch.length, missing: 0 });
      });

      const count = await deleteInChunks(ids, mockRemove);

      expect(count).toBe(totalItems);
      expect(mockRemove).toHaveBeenCalledTimes(3);
      expect(mockRemove.mock.calls[0][0].length).toBe(BULK_DELETE_LIMIT);
      expect(mockRemove.mock.calls[1][0].length).toBe(BULK_DELETE_LIMIT);
      expect(mockRemove.mock.calls[2][0].length).toBe(15);
    });
  });
});
