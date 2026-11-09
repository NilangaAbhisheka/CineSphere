/**
 * E2E Database Configuration — CineSphere
 *
 * Provides fail-closed validation and resolution of the dedicated E2E
 * database URL.  The E2E database is completely separate from the normal
 * development database and must be explicitly configured.
 *
 * Required environment variable:
 *   CINESPHERE_E2E_DATABASE_URL — connection string for the dedicated E2E
 *   PostgreSQL database.
 *
 * The variable must:
 *   - Be present (missing → abort with clear instructions).
 *   - Be a syntactically valid postgresql:// URL.
 *   - Target a database whose name contains "test" or "e2e" (case-insensitive).
 *   - NOT target the normal development database (name: "cinesphere" without
 *     a "test" or "e2e" qualifier).
 *
 * No fallback to DATABASE_URL or .env files is performed.  If this
 * validation fails, E2E execution aborts before any database connection
 * is established.
 */

/** The approved database name patterns for E2E use. */
const APPROVED_DB_PATTERNS = [/test/i, /e2e/i];

/** Exact development database name that must be rejected. */
const DEV_DB_NAME = 'cinesphere';

/**
 * Extracts the database name from a postgresql:// connection string.
 * Returns the path segment after the last '/', stripped of any query string.
 *
 * Example:
 *   "postgresql://user:pw@host:5432/cinesphere_test?schema=public"
 *   → "cinesphere_test"
 */
function extractDatabaseName(url: string): string {
  try {
    const parsed = new URL(url);
    // pathname is e.g. "/cinesphere_test"
    return parsed.pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
}

/**
 * Validates and returns the CINESPHERE_E2E_DATABASE_URL environment variable.
 *
 * Throws a descriptive Error if:
 *   - The variable is missing or empty.
 *   - The URL is not a valid postgresql:// connection string.
 *   - The target database name is not approved for E2E use.
 *   - The target database is the production development database.
 *
 * No database connection is established during validation.
 */
export function getE2eDatabaseUrl(): string {
  const url = process.env.CINESPHERE_E2E_DATABASE_URL;

  if (!url || url.trim() === '') {
    throw new Error(
      [
        '',
        '╔══════════════════════════════════════════════════════════════╗',
        '║   CineSphere E2E — MISSING DATABASE CONFIGURATION           ║',
        '╠══════════════════════════════════════════════════════════════╣',
        '║                                                              ║',
        '║  CINESPHERE_E2E_DATABASE_URL is not set.                    ║',
        '║                                                              ║',
        '║  E2E tests require a dedicated PostgreSQL database that is   ║',
        '║  completely separate from your development database.         ║',
        '║                                                              ║',
        '║  To configure:                                               ║',
        '║                                                              ║',
        '║  1. Create a dedicated test database:                        ║',
        '║     docker exec -it cinesphere-postgres psql \\              ║',
        '║       -U cinesphere_user -c                                  ║',
        '║       "CREATE DATABASE cinesphere_test;"                     ║',
        '║                                                              ║',
        '║  2. Apply migrations to the test database:                   ║',
        '║     CINESPHERE_E2E_DATABASE_URL=<url> \\                     ║',
        '║     DATABASE_URL=<url> pnpm prisma:migrate:e2e               ║',
        '║                                                              ║',
        '║  3. Set the variable before running E2E tests:               ║',
        '║     $env:CINESPHERE_E2E_DATABASE_URL = \\                    ║',
        '║       "postgresql://cinesphere_user:pw@localhost:5432/' +
          'cinesphere_test?schema=public"',
        '║     pnpm test:e2e                                            ║',
        '║                                                              ║',
        '║  See .env.example for the full variable reference.           ║',
        '╚══════════════════════════════════════════════════════════════╝',
        '',
      ].join('\n'),
    );
  }

  // Validate URL structure
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(
      `CINESPHERE_E2E_DATABASE_URL is not a valid URL: "${url}"\n` +
        'Expected format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME?schema=public',
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(
      `CINESPHERE_E2E_DATABASE_URL must use the postgresql:// protocol.\n` +
        `Received protocol: "${parsed.protocol}"`,
    );
  }

  const dbName = extractDatabaseName(url.trim());

  if (!dbName) {
    throw new Error(`CINESPHERE_E2E_DATABASE_URL does not contain a database name: "${url}"`);
  }

  // Reject the exact development database name (case-insensitive exact match)
  if (dbName.toLowerCase() === DEV_DB_NAME.toLowerCase()) {
    throw new Error(
      [
        '',
        `CINESPHERE_E2E_DATABASE_URL targets the development database "${dbName}".`,
        '',
        'E2E tests must NEVER run against the development database.',
        'Create and configure a dedicated E2E database (e.g. "cinesphere_test").',
        '',
        'See .env.example for configuration instructions.',
        '',
      ].join('\n'),
    );
  }

  // Require an approved test/e2e qualifier in the database name
  const isApproved = APPROVED_DB_PATTERNS.some((pattern) => pattern.test(dbName));
  if (!isApproved) {
    throw new Error(
      [
        '',
        `CINESPHERE_E2E_DATABASE_URL targets database "${dbName}".`,
        '',
        'The E2E database name must contain "test" or "e2e" to be accepted.',
        'This prevents accidental use of a non-test database.',
        '',
        `Approved examples: "cinesphere_test", "cinesphere_e2e"`,
        `Rejected:          "${dbName}"`,
        '',
      ].join('\n'),
    );
  }

  return url.trim();
}
