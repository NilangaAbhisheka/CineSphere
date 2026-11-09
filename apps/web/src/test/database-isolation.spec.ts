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

import { APPROVED_DB_TOKEN_PATTERN, getE2eDatabaseUrl } from '../../e2e/config/database-config';
import { deleteLibraryEntriesByIds } from '../../e2e/helpers/api';

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

  // ── Token precision rejections (substring loopholes) ──────────────────────

  it('throws when database name is "contest" (contains "test" substring without delimiter boundary)', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/contest?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/must contain "test" or "e2e"/i);
      },
    );
  });

  it('throws when database name is "mycontestdb"', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/mycontestdb?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/must contain "test" or "e2e"/i);
      },
    );
  });

  it('throws when database name is "cinesphere_testing" (requires exact "test" token, not "testing")', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/cinesphere_testing?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/must contain "test" or "e2e"/i);
      },
    );
  });

  it('throws when database name is "cinesphere_latest"', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/cinesphere_latest?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/must contain "test" or "e2e"/i);
      },
    );
  });

  it('throws when database name lacks delimiter boundary ("testdb" or "e2edb")', () => {
    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/testdb?schema=public',
      },
      () => {
        expect(() => getE2eDatabaseUrl()).toThrow(/must contain "test" or "e2e"/i);
      },
    );

    withEnv(
      {
        CINESPHERE_E2E_DATABASE_URL:
          'postgresql://cinesphere_user:pw@localhost:5432/e2edb?schema=public',
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

  it('accepts a URL targeting "cinesphere-test"', () => {
    const url = 'postgresql://cinesphere_user:pw@localhost:5432/cinesphere-test?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('accepts a URL targeting "cinesphere_e2e"', () => {
    const url = 'postgresql://user:pw@localhost:5432/cinesphere_e2e?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('accepts a URL targeting "cinesphere-e2e"', () => {
    const url = 'postgresql://user:pw@localhost:5432/cinesphere-e2e?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('accepts a URL targeting "test_cinesphere"', () => {
    const url = 'postgresql://user:pw@localhost:5432/test_cinesphere?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('accepts a URL targeting "e2e_cinesphere"', () => {
    const url = 'postgresql://user:pw@localhost:5432/e2e_cinesphere?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url);
    });
  });

  it('accepts uppercase and mixed-case test tokens ("CINESPHERE_TEST", "cinesphere_E2E")', () => {
    const url1 = 'postgresql://user:pw@localhost:5432/CINESPHERE_TEST?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url1 }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url1);
    });

    const url2 = 'postgresql://user:pw@localhost:5432/cinesphere_E2E?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url2 }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url2);
    });
  });

  it('accepts exact bare names "test" and "e2e"', () => {
    const url1 = 'postgresql://user:pw@localhost:5432/test?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url1 }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url1);
    });

    const url2 = 'postgresql://user:pw@localhost:5432/e2e?schema=public';
    withEnv({ CINESPHERE_E2E_DATABASE_URL: url2 }, () => {
      expect(() => getE2eDatabaseUrl()).not.toThrow();
      expect(getE2eDatabaseUrl()).toBe(url2);
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

// ── Pattern-level token validation ──────────────────────────────────────────

describe('APPROVED_DB_TOKEN_PATTERN delimiter-aware token matching', () => {
  const validNames = [
    'cinesphere_test',
    'cinesphere-test',
    'cinesphere_e2e',
    'cinesphere-e2e',
    'test_cinesphere',
    'e2e_cinesphere',
    'test-cinesphere',
    'e2e-cinesphere',
    'test',
    'e2e',
    'TEST',
    'E2E',
    'cinesphere_TEST',
    'cinesphere_E2E',
    'db_test_suite',
    'app-e2e-run',
  ];

  const invalidNames = [
    'cinesphere',
    'contest',
    'mycontestdb',
    'cinesphere_testing',
    'testing',
    'cinesphere_latest',
    'testdb',
    'dbtest',
    'e2edb',
    'dbe2e',
    'note2e',
    'prode2e',
    'staging',
    'production',
  ];

  it.each(validNames)('approves valid test/e2e token database name: "%s"', (name) => {
    expect(APPROVED_DB_TOKEN_PATTERN.test(name)).toBe(true);
  });

  it.each(invalidNames)('rejects non-test or embedded-substring database name: "%s"', (name) => {
    expect(APPROVED_DB_TOKEN_PATTERN.test(name)).toBe(false);
  });
});

// ── Cleanup ownership precision ──────────────────────────────────────────────

describe('E2E Cleanup Ownership — deleteLibraryEntriesByIds()', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('performs no HTTP requests when passed an empty array []', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await deleteLibraryEntriesByIds([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores empty strings and whitespace-only IDs without making HTTP requests', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await deleteLibraryEntriesByIds(['', '   ', '\t']);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes only the exact ID passed to it via DELETE /api/library/:id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;

    const targetId = 'uuid-test-entry-123';
    await deleteLibraryEntriesByIds([targetId]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/library/${targetId}$`)),
      { method: 'DELETE' },
    );
  });

  it('deletes multiple explicit IDs and strictly no other IDs', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;

    const ids = ['entry-aaa', 'entry-bbb', 'entry-ccc'];
    await deleteLibraryEntriesByIds(ids);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const id of ids) {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/library/${id}$`)), {
        method: 'DELETE',
      });
    }
  });

  it('filters out blank elements and deletes only valid IDs from a mixed list', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = fetchMock;

    await deleteLibraryEntriesByIds(['valid-id-1', '', '  ', 'valid-id-2']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/library\/valid-id-1$/), {
      method: 'DELETE',
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/library\/valid-id-2$/), {
      method: 'DELETE',
    });
  });

  it('ignores 404 responses gracefully (idempotent deletion when record is already absent)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    global.fetch = fetchMock;

    await expect(deleteLibraryEntriesByIds(['non-existent-id'])).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates non-404 HTTP errors with a descriptive error message', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    global.fetch = fetchMock;

    await expect(deleteLibraryEntriesByIds(['failing-id'])).rejects.toThrow(
      /deleteLibraryEntry\(failing-id\) failed: 500 Internal Server Error/,
    );
  });
});
