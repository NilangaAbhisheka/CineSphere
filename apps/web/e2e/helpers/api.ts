/**
 * E2E API Helper — CineSphere Stage 3.8
 *
 * Direct fetch wrappers around the NestJS REST API for test setup and
 * teardown.  These are used in globalSetup, globalTeardown, and per-test
 * afterAll hooks to create and clean up test data without going through the UI.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// ── Types (minimal subset needed for E2E helpers) ────────────────────────────

export interface LibraryEntryItem {
  id: string;
  status: string;
  mediaType: string;
  title: string;
}

export interface PaginatedLibraryResult {
  items?: Array<{
    id: string;
    status: string;
    mediaType: string;
    movie?: { title: string } | null;
    tvShow?: { name: string } | null;
  }>;
  data?: LibraryEntryItem[];
  totalResults?: number;
  total?: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Library helpers ──────────────────────────────────────────────────────────

/**
 * Returns all library entries for the single-user (paginated, page 1,
 * limit 100 — sufficient for E2E cleanup).
 */
export async function listLibraryEntries(): Promise<LibraryEntryItem[]> {
  const res = await fetch(`${API_BASE}/library?limit=100&page=1`);
  if (!res.ok) {
    throw new Error(`listLibraryEntries failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as PaginatedLibraryResult;
  if (Array.isArray(body.items)) {
    return body.items.map((raw) => ({
      id: raw.id,
      status: raw.status,
      mediaType: raw.mediaType,
      title: raw.movie?.title ?? raw.tvShow?.name ?? '',
    }));
  }
  return body.data ?? [];
}

/**
 * Deletes a single library entry by ID.
 */
export async function deleteLibraryEntry(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/library/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteLibraryEntry(${id}) failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Deletes multiple library entries by their explicit IDs.
 * Constrained strictly to the provided IDs; performs no operations if
 * the list is empty or contains only blank/whitespace strings.
 * Never deletes records by title substring, pattern, or media type.
 */
export async function deleteLibraryEntriesByIds(ids: string[]): Promise<void> {
  const validIds = ids.filter((id) => typeof id === 'string' && id.trim().length > 0);
  if (validIds.length === 0) {
    return;
  }
  await Promise.all(validIds.map((id) => deleteLibraryEntry(id.trim())));
}

/**
 * Creates a library entry via the REST API (bypasses UI for setup).
 */
export async function createLibraryEntry(payload: {
  mediaType: 'MOVIE' | 'TV';
  tmdbId: number;
  status?: string;
}): Promise<LibraryEntryItem> {
  const res = await fetch(`${API_BASE}/library`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaType: payload.mediaType,
      tmdbId: payload.tmdbId,
      status: payload.status ?? 'PLAN_TO_WATCH',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createLibraryEntry failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<LibraryEntryItem>;
}

// ── Dashboard helpers ────────────────────────────────────────────────────────

export async function getDashboardOverview(): Promise<unknown> {
  const res = await fetch(`${API_BASE}/dashboard/overview`);
  if (!res.ok) {
    throw new Error(`getDashboardOverview failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
