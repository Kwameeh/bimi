// Shared guardrails for the multi-select delete mutations.
//
// Every `removeMany` in this codebase goes through `assertBulkSize`, so the cap
// is stated once and every table inherits it. The cap exists because a Convex
// mutation is a single transaction: an unbounded id list means an unbounded
// write set, which fails late and noisily rather than early and clearly. The
// client chunks anything larger.
export const BULK_DELETE_LIMIT = 100;

export function assertBulkSize(ids: readonly unknown[]): void {
  if (ids.length === 0) {
    throw new Error('Nothing selected');
  }
  if (ids.length > BULK_DELETE_LIMIT) {
    throw new Error(`Select at most ${BULK_DELETE_LIMIT} items to delete at once`);
  }
}

/**
 * Ids arrive from a list the user was looking at, so by the time the mutation
 * runs some of them may already be gone — another device deleted one, a draft
 * was sent, a cron swept an expiry. Deleting what is still there and reporting
 * the count is the right behaviour; throwing would lose the whole batch over
 * one stale row.
 */
export function bulkResult(deleted: number, requested: number) {
  return { deleted, missing: requested - deleted };
}
