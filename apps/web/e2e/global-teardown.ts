/**
 * E2E Global Teardown — CineSphere Stage 3.8
 *
 * Catalogue seed records ([E2E] prefix) are intentionally persisted across
 * runs for idempotency.  Library entries are cleaned up by per-test afterAll
 * hooks, so there is nothing to do globally here.
 */
export default async function globalTeardown(): Promise<void> {
  // Catalogue seed records ([E2E] prefix) are intentionally persisted.
  // Per-test afterAll hooks are responsible for deleting library entries.
  console.log('[E2E] Global teardown complete.');
}
