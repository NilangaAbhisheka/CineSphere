/**
 * E2E Global Setup — CineSphere Stage 3.8
 *
 * Seeds the test catalogue items (movie + TV show with seasons/episodes)
 * that the E2E test suite relies on.  Catalogue records are upserted so
 * repeated runs are idempotent.  Library entries created during each test
 * are deleted by per-test afterAll hooks — not here.
 *
 * Uses raw pg SQL to avoid Prisma codegen dependency in apps/web.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// ── Shared E2E seed constants (re-exported for use in test files) ────────────
export const E2E_MOVIE_TMDB_ID = 9_000_001;
export const E2E_MOVIE_TITLE = '[E2E] Inception Test Film';

export const E2E_TV_TMDB_ID = 9_000_002;
export const E2E_TV_TITLE = '[E2E] Breaking Test Series';
export const E2E_TV_SEASON_NUMBER = 1;
export const E2E_TV_EPISODE_COUNT = 3;

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // Search for .env upwards
  let dir = process.cwd();
  for (let i = 0; i < 3; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
        if (match) {
          return match[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }
    }
    dir = path.dirname(dir);
  }
  return 'postgresql://cinesphere_user:cinesphere_dev_password@localhost:5432/cinesphere?schema=public';
}

export default async function globalSetup(): Promise<void> {
  const client = new Client({
    connectionString: getDatabaseUrl(),
  });

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
