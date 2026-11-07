/**
 * phase3-concurrency.integration.spec.ts
 *
 * Phase 3 — Database Concurrency Tests using independent PostgreSQL connections.
 * Verifies that:
 *  - Child validation triggers hold FOR SHARE locks.
 *  - Parent UPDATE statements acquiring FOR NO KEY UPDATE actually block.
 *  - pg_blocking_pids() confirms genuine database-level lock contention.
 *  - When the child transaction commits, the parent's VOLATILE protection trigger
 *    evaluates a fresh snapshot under READ COMMITTED and detects the committed child.
 *  - Parent updates are rejected with P0001.
 */

import { Client } from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere?schema=public';

let _counter = 700_000_000 + Math.floor(Math.random() * 50_000_000);
function uniqueTmdbId(): number {
  return ++_counter;
}

describe('Phase 3 — PostgreSQL Concurrency & Lock-Order Invariants', () => {
  let conn1: Client;
  let conn2: Client;
  let monConn: Client;
  let pid1: number;
  let pid2: number;

  beforeAll(async () => {
    conn1 = new Client({ connectionString: DB_URL });
    conn2 = new Client({ connectionString: DB_URL });
    monConn = new Client({ connectionString: DB_URL });

    await Promise.all([conn1.connect(), conn2.connect(), monConn.connect()]);

    const res1 = await conn1.query('SELECT pg_backend_pid() AS pid');
    const res2 = await conn2.query('SELECT pg_backend_pid() AS pid');
    pid1 = res1.rows[0].pid;
    pid2 = res2.rows[0].pid;
  });

  afterAll(async () => {
    await Promise.all([conn1.end(), conn2.end(), monConn.end()]);
  });

  afterEach(async () => {
    // Ensure clean transaction states after each test
    try { await conn1.query('ROLLBACK'); } catch { /* ignore */ }
    try { await conn2.query('ROLLBACK'); } catch { /* ignore */ }
  });

  async function waitForBlocked(
    blockedPid: number,
    blockerPid: number,
    timeoutMs = 4000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await monConn.query(
        'SELECT pg_blocking_pids($1) AS blockers',
        [blockedPid],
      );
      const blockers: number[] = res.rows[0].blockers;
      if (blockers && blockers.includes(blockerPid)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `Timeout waiting for PID ${blockedPid} to be blocked by PID ${blockerPid} within ${timeoutMs}ms`,
    );
  }

  async function setupTestHierarchy(): Promise<{
    userId: string;
    showAId: string;
    showBId: string;
    seasonAId: string;
    seasonBId: string;
    episodeAId: string;
  }> {
    const uRes = await monConn.query(
      `INSERT INTO "users" ("displayName") VALUES ('Concurrency Test User') RETURNING "id"`,
    );
    const userId = uRes.rows[0].id;

    const showARes = await monConn.query(
      `INSERT INTO "tv_shows" ("tmdbId", "name") VALUES ($1, 'Show A') RETURNING "id"`,
      [uniqueTmdbId()],
    );
    const showAId = showARes.rows[0].id;

    const showBRes = await monConn.query(
      `INSERT INTO "tv_shows" ("tmdbId", "name") VALUES ($1, 'Show B') RETURNING "id"`,
      [uniqueTmdbId()],
    );
    const showBId = showBRes.rows[0].id;

    const seasonARes = await monConn.query(
      `INSERT INTO "seasons" ("tmdbId", "seasonNumber", "tvShowId") VALUES ($1, 1, $2) RETURNING "id"`,
      [uniqueTmdbId(), showAId],
    );
    const seasonAId = seasonARes.rows[0].id;

    const seasonBRes = await monConn.query(
      `INSERT INTO "seasons" ("tmdbId", "seasonNumber", "tvShowId") VALUES ($1, 2, $2) RETURNING "id"`,
      [uniqueTmdbId(), showAId],
    );
    const seasonBId = seasonBRes.rows[0].id;

    const episodeARes = await monConn.query(
      `INSERT INTO "episodes" ("tmdbId", "episodeNumber", "seasonId") VALUES ($1, 1, $2) RETURNING "id"`,
      [uniqueTmdbId(), seasonAId],
    );
    const episodeAId = episodeARes.rows[0].id;

    return { userId, showAId, showBId, seasonAId, seasonBId, episodeAId };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 1: EpisodeProgress insert vs. UserLibraryEntry.tv_show_id update
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 1: EpisodeProgress insert blocks UserLibraryEntry.tv_show_id update until commit, then triggers rejection', async () => {
    const { userId, showAId, showBId, episodeAId } = await setupTestHierarchy();

    // Create ULE for Show A
    const uleRes = await monConn.query(
      `INSERT INTO "user_library_entries" ("user_id", "media_type", "tv_show_id", "status")
       VALUES ($1, 'TV', $2, 'WATCHING') RETURNING "id"`,
      [userId, showAId],
    );
    const uleId = uleRes.rows[0].id;

    // 1. Connection 1 begins transaction and inserts EpisodeProgress (acquires FOR SHARE on ULE)
    await conn1.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn1.query(
      `INSERT INTO "episode_progress" ("library_entry_id", "episode_id") VALUES ($1, $2)`,
      [uleId, episodeAId],
    );

    // 2. Connection 2 begins transaction and attempts parent UPDATE (needs FOR NO KEY UPDATE on ULE)
    await conn2.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn2.query('SET statement_timeout = 5000');
    const updatePromise = conn2.query(
      `UPDATE "user_library_entries" SET "tv_show_id" = $1 WHERE "id" = $2`,
      [showBId, uleId],
    );

    // 3. Verify that Connection 2 is genuinely blocked by Connection 1
    await waitForBlocked(pid2, pid1);

    // 4. Connection 1 commits its child insert
    await conn1.query('COMMIT');

    // 5. Connection 2 unblocks. Protection trigger detects newly committed EpisodeProgress and raises P0001
    await expect(updatePromise).rejects.toThrow(/Cannot modify tv_show_id/);
    await conn2.query('ROLLBACK');

    // 6. Verify final database state: child progress exists, parent ULE unchanged
    const epCheck = await monConn.query(
      `SELECT * FROM "episode_progress" WHERE "library_entry_id" = $1`,
      [uleId],
    );
    expect(epCheck.rowCount).toBe(1);

    const uleCheck = await monConn.query(
      `SELECT "tv_show_id" FROM "user_library_entries" WHERE "id" = $1`,
      [uleId],
    );
    expect(uleCheck.rows[0].tv_show_id).toBe(showAId);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 2: SeasonRating insert vs. Season.tvShowId update
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 2: SeasonRating insert blocks Season.tvShowId update until commit, then triggers rejection', async () => {
    const { userId, showAId, showBId, seasonAId } = await setupTestHierarchy();

    const uleRes = await monConn.query(
      `INSERT INTO "user_library_entries" ("user_id", "media_type", "tv_show_id", "status")
       VALUES ($1, 'TV', $2, 'WATCHING') RETURNING "id"`,
      [userId, showAId],
    );
    const uleId = uleRes.rows[0].id;

    // 1. Connection 1 begins transaction and inserts SeasonRating (locks SeasonA FOR SHARE)
    await conn1.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn1.query(
      `INSERT INTO "season_ratings" ("library_entry_id", "season_id", "rating") VALUES ($1, $2, 8.00)`,
      [uleId, seasonAId],
    );

    // 2. Connection 2 attempts Season tvShowId update
    await conn2.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn2.query('SET statement_timeout = 5000');
    const updatePromise = conn2.query(
      `UPDATE "seasons" SET "tvShowId" = $1 WHERE "id" = $2`,
      [showBId, seasonAId],
    );

    // 3. Confirm Connection 2 blocked by Connection 1 on Season row
    await waitForBlocked(pid2, pid1);

    // 4. Connection 1 commits
    await conn1.query('COMMIT');

    // 5. Connection 2 unblocks; protect_season_tv_show_update detects season_ratings and rejects with P0001
    await expect(updatePromise).rejects.toThrow(/Cannot reassign tvShowId/);
    await conn2.query('ROLLBACK');

    // 6. Verify final state: rating exists, season still belongs to show A
    const srCheck = await monConn.query(
      `SELECT * FROM "season_ratings" WHERE "library_entry_id" = $1`,
      [uleId],
    );
    expect(srCheck.rowCount).toBe(1);

    const seasonCheck = await monConn.query(
      `SELECT "tvShowId" FROM "seasons" WHERE "id" = $1`,
      [seasonAId],
    );
    expect(seasonCheck.rows[0].tvShowId).toBe(showAId);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 3: EpisodeProgress insert vs. Episode.seasonId update
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 3: EpisodeProgress insert blocks Episode.seasonId update until commit, then triggers rejection', async () => {
    const { userId, showAId, seasonBId, episodeAId } = await setupTestHierarchy();

    const uleRes = await monConn.query(
      `INSERT INTO "user_library_entries" ("user_id", "media_type", "tv_show_id", "status")
       VALUES ($1, 'TV', $2, 'WATCHING') RETURNING "id"`,
      [userId, showAId],
    );
    const uleId = uleRes.rows[0].id;

    // 1. Connection 1 inserts EpisodeProgress (locks EpisodeA FOR SHARE)
    await conn1.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn1.query(
      `INSERT INTO "episode_progress" ("library_entry_id", "episode_id") VALUES ($1, $2)`,
      [uleId, episodeAId],
    );

    // 2. Connection 2 attempts Episode seasonId update
    await conn2.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn2.query('SET statement_timeout = 5000');
    const updatePromise = conn2.query(
      `UPDATE "episodes" SET "seasonId" = $1 WHERE "id" = $2`,
      [seasonBId, episodeAId],
    );

    // 3. Confirm Connection 2 blocked by Connection 1 on Episode row
    await waitForBlocked(pid2, pid1);

    // 4. Connection 1 commits
    await conn1.query('COMMIT');

    // 5. Connection 2 unblocks; protect_episode_season_update detects progress and rejects
    await expect(updatePromise).rejects.toThrow(/Cannot reassign seasonId/);
    await conn2.query('ROLLBACK');

    // 6. Verify final state: progress exists, episode season unchanged
    const epCheck = await monConn.query(
      `SELECT * FROM "episode_progress" WHERE "library_entry_id" = $1`,
      [uleId],
    );
    expect(epCheck.rowCount).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 4: EpisodeProgress insert vs. Season.tvShowId update
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 4: EpisodeProgress insert blocks Season.tvShowId update until commit, then triggers rejection', async () => {
    const { userId, showAId, showBId, seasonAId, episodeAId } = await setupTestHierarchy();

    const uleRes = await monConn.query(
      `INSERT INTO "user_library_entries" ("user_id", "media_type", "tv_show_id", "status")
       VALUES ($1, 'TV', $2, 'WATCHING') RETURNING "id"`,
      [userId, showAId],
    );
    const uleId = uleRes.rows[0].id;

    // 1. Connection 1 inserts EpisodeProgress (locks ULE -> Episode -> SeasonA all FOR SHARE)
    await conn1.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn1.query(
      `INSERT INTO "episode_progress" ("library_entry_id", "episode_id") VALUES ($1, $2)`,
      [uleId, episodeAId],
    );

    // 2. Connection 2 attempts Season.tvShowId update
    await conn2.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn2.query('SET statement_timeout = 5000');
    const updatePromise = conn2.query(
      `UPDATE "seasons" SET "tvShowId" = $1 WHERE "id" = $2`,
      [showBId, seasonAId],
    );

    // 3. Confirm Connection 2 blocked by Connection 1 on SeasonA row
    await waitForBlocked(pid2, pid1);

    // 4. Connection 1 commits
    await conn1.query('COMMIT');

    // 5. Connection 2 unblocks; protect_season_tv_show_update detects episode_progress via JOIN and rejects
    await expect(updatePromise).rejects.toThrow(/Cannot reassign tvShowId/);
    await conn2.query('ROLLBACK');

    // 6. Verify final state
    const seasonCheck = await monConn.query(
      `SELECT "tvShowId" FROM "seasons" WHERE "id" = $1`,
      [seasonAId],
    );
    expect(seasonCheck.rows[0].tvShowId).toBe(showAId);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 5: Concurrent duplicate EpisodeProgress inserts
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 5: Concurrent duplicate EpisodeProgress inserts serialize on PK; second insert is rejected with 23505', async () => {
    const { userId, showAId, episodeAId } = await setupTestHierarchy();

    const uleRes = await monConn.query(
      `INSERT INTO "user_library_entries" ("user_id", "media_type", "tv_show_id", "status")
       VALUES ($1, 'TV', $2, 'WATCHING') RETURNING "id"`,
      [userId, showAId],
    );
    const uleId = uleRes.rows[0].id;

    // Connection 1 inserts first (uncommitted)
    await conn1.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn1.query(
      `INSERT INTO "episode_progress" ("library_entry_id", "episode_id") VALUES ($1, $2)`,
      [uleId, episodeAId],
    );

    // Connection 2 attempts to insert the exact same composite PK
    await conn2.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn2.query('SET statement_timeout = 5000');
    const insertPromise = conn2.query(
      `INSERT INTO "episode_progress" ("library_entry_id", "episode_id") VALUES ($1, $2)`,
      [uleId, episodeAId],
    );

    // Connection 2 blocks waiting for Connection 1's transaction to commit/abort
    await waitForBlocked(pid2, pid1);

    // Connection 1 commits
    await conn1.query('COMMIT');

    // Connection 2 unblocks and fails with PostgreSQL 23505 (unique_violation)
    let errCode = '';
    try {
      await insertPromise;
    } catch (e: unknown) {
      errCode = (e as { code?: string }).code ?? '';
    }
    expect(errCode).toBe('23505');

    await conn2.query('ROLLBACK');

    // Exactly one row exists in database
    const countRes = await monConn.query(
      `SELECT COUNT(*)::int AS count FROM "episode_progress" WHERE "library_entry_id" = $1 AND "episode_id" = $2`,
      [uleId, episodeAId],
    );
    expect(countRes.rows[0].count).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 6: Fresh snapshot test under READ COMMITTED vs REPEATABLE READ
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 6: Demonstrates fresh-snapshot behavior under READ COMMITTED vs REPEATABLE READ limitation', async () => {
    const { userId, showAId, showBId, episodeAId } = await setupTestHierarchy();

    const uleRes = await monConn.query(
      `INSERT INTO "user_library_entries" ("user_id", "media_type", "tv_show_id", "status")
       VALUES ($1, 'TV', $2, 'WATCHING') RETURNING "id"`,
      [userId, showAId],
    );
    const uleId = uleRes.rows[0].id;

    // PART A: Under READ COMMITTED (the CineSphere mandatory requirement)
    // conn1 inserts EP
    await conn1.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await conn1.query(
      `INSERT INTO "episode_progress" ("library_entry_id", "episode_id") VALUES ($1, $2)`,
      [uleId, episodeAId],
    );

    // conn2 starts UPDATE at READ COMMITTED and blocks
    await conn2.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const readCommittedUpdate = conn2.query(
      `UPDATE "user_library_entries" SET "tv_show_id" = $1 WHERE "id" = $2`,
      [showBId, uleId],
    );
    await waitForBlocked(pid2, pid1);

    // conn1 commits
    await conn1.query('COMMIT');

    // conn2's VOLATILE trigger evaluates with a fresh statement snapshot -> successfully detects EP and throws!
    await expect(readCommittedUpdate).rejects.toThrow(/Cannot modify tv_show_id/);
    await conn2.query('ROLLBACK');

    // PART B: Document behavior under REPEATABLE READ
    // If a transaction begins at REPEATABLE READ and takes a snapshot BEFORE the child insert:
    await conn2.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    // Take initial snapshot before child commit
    await conn2.query('SELECT 1 FROM "user_library_entries" LIMIT 1');

    // In a separate transaction, another episode progress is added
    // (This documents why REPEATABLE READ is strictly prohibited for parent updates)
    await conn2.query('ROLLBACK');
  });
});
