import { useCallback, useMemo, useState } from 'react';

/**
 * Multi-select state for a list screen.
 *
 * Selection mode is explicit rather than inferred from `ids.size > 0`: without
 * it, deselecting the last row would silently drop you out of the mode you are
 * still working in, and every screen would have to special-case that.
 *
 * Ids are held as strings because Convex `Id<T>` values are branded strings and
 * a `Set` keyed on them compares by value.
 */
export function useSelection<T extends string>() {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<ReadonlySet<T>>(() => new Set());

  const toggle = useCallback((id: T) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Enter selection mode with one row already picked — the long-press entry. */
  const begin = useCallback((id: T) => {
    setActive(true);
    setIds(new Set([id]));
  }, []);

  const enter = useCallback(() => setActive(true), []);

  const exit = useCallback(() => {
    setActive(false);
    setIds(new Set());
  }, []);

  /**
   * Select-all is a toggle against the rows currently on screen, so it respects
   * whatever filter or search the user has applied rather than reaching past it.
   */
  const setAll = useCallback((all: readonly T[]) => {
    setIds((prev) => (prev.size >= all.length ? new Set() : new Set(all)));
  }, []);

  const isSelected = useCallback((id: T) => ids.has(id), [ids]);

  return useMemo(
    () => ({
      active,
      ids,
      count: ids.size,
      selected: [...ids] as T[],
      isSelected,
      toggle,
      begin,
      enter,
      exit,
      setAll,
    }),
    [active, ids, isSelected, toggle, begin, enter, exit, setAll],
  );
}

export type Selection<T extends string> = ReturnType<typeof useSelection<T>>;

/** Mirrors BULK_DELETE_LIMIT in convex/bulkDelete.ts. */
export const BULK_DELETE_LIMIT = 100;

/**
 * Run a `removeMany` mutation over any number of ids, in server-sized batches.
 * The cap is a transaction-size limit on the backend, not a product decision, so
 * the user should never have to think about it.
 */
export async function deleteInChunks<T extends string>(
  ids: readonly T[],
  removeMany: (batch: T[]) => Promise<{ deleted: number; missing: number }>,
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BULK_DELETE_LIMIT) {
    const batch = ids.slice(i, i + BULK_DELETE_LIMIT) as T[];
    const result = await removeMany(batch);
    deleted += result.deleted;
  }
  return deleted;
}
