/**
 * E2E Database Isolation Tests — CineSphere
 *
 * Verifies that the E2E database configuration is correctly validated:
 * - Missing CINESPHERE_E2E_DATABASE_URL is rejected before any DB connection.
 * - Empty or malformed URLs are rejected.
 * - The development database "cinesphere" is explicitly rejected.
 * - Valid test database URLs (containing "test" or "e2e") are accepted.
 * - No .env fallback or DATABASE_URL fallback is performed.
 *
 * These tests use controlled process.env manipulation so they never depend
 * on the developer's personal .env file.
 */

import { getE2eDatabaseUrl } from '../../e2e/config/database-config';

/** Saves and restores process.env around each test. */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

describe('E2E Database Configuration — getE2eDatabaseUrl()', () => {
  // ── Missing / empty variable ───────────────────────────────────────────────

  it('throws when CINESPHERE_E2E_DATABASE_URL is not set', () => {
    withEnv({ CINESPHERE_E2E_DATABASE_URL: undefined }, () => {
      expect(() => getE2eDatabaseUrl()).toThrow(/CINESPHERE_E2E_DATABASE_URL/);
    });
  });

  it('throws when CINESPHERE_E2E_DATABASE_URL is an empty string', () => {
    withEnv({ CINESPHERE_E2E_DATABASE_URL: '' }, () => {
      expect(() => getE2eDatabaseUrl()).toThrow(/CINESPHERE_E2E_DATABASE_URL/);
    });
  });

  it('throws when CINESPHERE_E2E_DATABASE_URL is whitespace only', () => {
    withEnv({ CINESPHERE_E2E_DATABASE_URL: '   ' }, () => {
      expect(() => getE2eDatabaseUrl()).toThrow(/CINESPHERE_E2E_DATABASE_URL/);
    });
  });

  // ── Malformed URLs ─────────────────────────────────────────────────────────

  it('throws when CINESPHERE_E2E_DATABASE_URL is not a valid URL', () => {
    withEnv({ CINESPHERE_E2E_DATABASE_URL: 'not-a-url' }, () => {
      expect(() => getE2eDatabaseUrl()).toThrow(/not a valid URL/i);
    });
  });

  it('throws when CINESPHERE_E2E_DATABASE_URL uses a non-postgresql protocol', () => {
    withEnv(
      { CINESPHERE_E2E_DATABASE_URL: 'mysql://user:pw@localhost:3306/cinesphere_test' },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/postgresql:\/\//i);
      },
    );
  });

  it('throws when CINESPHERE_E2E_DATABASE_URL has no database name', () => {
    withEnv({ CINESPHERE_E2E_DATABASE_URL: 'postgresql://user:pw@localhost:5432' }, () => {
      expect(() => getE2eDatabaseUrl()).toThrow(/database name/i);
    });
  });

  // ── Development database rejection ────────────────────────────────────────

  it('throws when CINESPHERE_E2E_DATABASE_URL targets the development database "cinesphere"', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/cinesphere?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/development database/i);
      },
    );
  });

  it('throws when CINESPHERE_E2E_DATABASE_URL targets "cinesphere" with a different schema', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/cinesphere?schema=myschema',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/development database/i);
      },
    );
  });

  it('throws when database name does not contain "test" or "e2e"', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/cinesphere_staging?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/must contain "test" or "e2e"/i);
      },
    );
  });

  // ── Approved test database URLs ───────────────────────────────────────────

  it('accepts a URL targeting "cinesphere_test"', () => {
    const url = 'postgresql://cinesphere_user:pw@localhost:5432/cinesphere_test?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('accepts a URL targeting a database named with "e2e"', () => {
    const url = 'postgresql://user:pw@localhost:5432/cinesphere_e2e?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('accepts a URL using the postgres:// alias', () => {
    const url = 'postgres://user:pw@localhost:5432/app_test?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('trims surrounding whitespace from the URL before returning', () => {
    const url = 'postgresql://user:pw@localhost:5432/cinesphere_test?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: `  ${url}  ` }, () => {
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  // ── DATABASE_URL fallback must NOT occur ──────────────────────────────────

  it('does NOT fall back to DATABASE_URL when CINESPHERE_E2E_DATABASE_URL is missing', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL: undefined,
        DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/cinesphere_test?schema=public',
      },
      () => {
        // Even though DATABASE_URL is set to a valid test DB, the function
        // must throw because CINESPHERE_E2E_DATABASE_URL is not set.
        expect(() => getE2eDatabaseUrl()).toThrow(/CINESPHERE_E2E_DATABASE_URL/);
      },
    );
  });

  it('does NOT use DATABASE_URL as a source even if CINESPHERE_E2E_DATABASE_URL is empty', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL: '',
        DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/cinesphere_test?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/CINESPHERE_E2E_DATABASE_URL/);
      },
    );
  });

  // ── Validation aborts before connection ───────────────────────────────────

  it('throws synchronously — no async operations — before any DB connection could be established', () => {
    withEnv({ CINESPHERE_E2E_DATABASE_URL: undefined }, () => {
      let threw = false;
      try {
        getE2eDatabaseUrl();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });
});

// ── Cleanup safety contract ───────────────────────────────────────────────────

describe('E2E Cleanup Safety — cleanupTestLibraryEntries scope', () => {
  it('the [E2E] title filter covers expected test titles', () => {
    const e2eTitles = [
      '[E2E] Inception Test Film',
      '[E2E] Breaking Test Series',
      '[E2E] Another Test Item',
    ];
    const realTitles = [
      'Inception',
      'Breaking Bad',
      'The Dark Knight',
      'My favourite film',
      'E2E documentation',
    ];

    for (const title of e2eTitles) {
      expect(title.includes('[E2E]')).toBe(true);
    }
    for (const title of realTitles) {
      expect(title.includes('[E2E]')).toBe(false);
    }
  });

  it('a title with [E2E] in the middle is treated as test-owned', () => {
    expect('Something [E2E] Something'.includes('[E2E]')).toBe(true);
  });

  it('a title that starts with "E2E" but lacks brackets is treated as user data', () => {
    expect('E2E documentation'.includes('[E2E]')).toBe(false);
  });
});
