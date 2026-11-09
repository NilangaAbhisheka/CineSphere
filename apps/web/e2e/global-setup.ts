/**
 * E2E Global Setup — CineSphere
 *
 * Seeds the test catalogue items (movie + TV show with seasons/episodes)
 * that the E2E test suite relies on.  Catalogue records are upserted so
 * repeated runs are idempotent.  Library entries created during each test
 * are deleted by per-test afterAll hooks — not here.
 *
 * Database connection is obtained exclusively from CINESPHERE_E2E_DATABASE_URL.
 * No fallback to DATABASE_URL or .env files is performed.  Missing or unsafe
 * configuration causes immediate abort before any database operation.
 *
 * Uses raw pg SQL to avoid Prisma codegen dependency in apps/web.
 */
import { Client } from 'pg';
import { getE2eDatabaseUrl } from './config/database-config';

// ── Shared E2E seed constants (re-exported for use in test files) ────────────
export const E2E_MOVIE_TMDB_ID = 9_000_001;
export const E2E_MOVIE_TITLE = '[E2E] Inception Test Film';

export const E2E_TV_TMDB_ID = 9_000_002;
export const E2E_TV_TITLE = '[E2E] Breaking Test Series';
export const E2E_TV_SEASON_NUMBER = 1;
export const E2E_TV_EPISODE_COUNT = 3;

export default async function globalSetup(): Promise<void> {
  // Fail-closed: validate the dedicated E2E database URL before connecting.
  // This throws with a clear error message if configuration is missing or unsafe.
  const connectionString = getE2eDatabaseUrl();

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // ── 1. Upsert test movie ───────────────────────────────────────────────
    await client.query(
      `INSERT INTO movies ("tmdbId", "title", "overview", "voteAverage", "popularity", "releaseDate")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("tmdbId") DO UPDATE SET "title" = EXCLUDED."title"`,
      [
        E2E_MOVIE_TMDB_ID,
        E2E_MOVIE_TITLE,
        'E2E test movie for automated testing. Do not modify.',
        8.5,
        100.0,
        '2010-07-16',
      ],
    );

    // ── 2. Upsert test TV show ─────────────────────────────────────────────
    const tvResult = await client.query(
      `INSERT INTO tv_shows ("tmdbId", "name", "overview", "numberOfSeasons", "numberOfEpisodes", "voteAverage", "popularity")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("tmdbId") DO UPDATE SET "name" = EXCLUDED."name"
       RETURNING id`,
      [
        E2E_TV_TMDB_ID,
        E2E_TV_TITLE,
        'E2E test TV show for automated testing. Do not modify.',
        1,
        E2E_TV_EPISODE_COUNT,
        9.0,
        150.0,
      ],
    );
    const tvShowId: string = tvResult.rows[0].id;

    // ── 3. Upsert Season 1 ────────────────────────────────────────────────
    const seasonResult = await client.query(
      `INSERT INTO seasons ("tvShowId", "seasonNumber", "name")
       VALUES ($1, $2, $3)
       ON CONFLICT ("tvShowId", "seasonNumber") DO UPDATE SET "name" = EXCLUDED."name"
       RETURNING id`,
      [tvShowId, E2E_TV_SEASON_NUMBER, 'Season 1'],
    );
    const seasonId: string = seasonResult.rows[0].id;

    // ── 4. Upsert Episodes 1–3 ────────────────────────────────────────────
    for (let i = 1; i <= E2E_TV_EPISODE_COUNT; i++) {
      await client.query(
        `INSERT INTO episodes ("seasonId", "episodeNumber", "name")
         VALUES ($1, $2, $3)
         ON CONFLICT ("seasonId", "episodeNumber") DO NOTHING`,
        [seasonId, i, `Episode ${i}`],
      );
    }

    console.log('[E2E] Global setup complete — test catalogue seeded.');
  } finally {
    await client.end();
  }
}
