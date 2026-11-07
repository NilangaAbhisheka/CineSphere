/**
 * library/page.spec.tsx
 *
 * Unit tests for the My Library page component.
 * apiClient.listLibrary is mocked — no network calls are made.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LibraryPage from '@/app/library/page';
import { LibraryEntryListItem } from '@cinesphere/shared';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockListLibrary = jest.fn();
const mockGetLibraryEntry = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    listLibrary: (...args: unknown[]) => mockListLibrary(...args),
    getLibraryEntry: (...args: unknown[]) => mockGetLibraryEntry(...args),
    updateLibraryEntry: jest.fn(),
    deleteLibraryEntry: jest.fn(),
    createViewingEvent: jest.fn(),
    createEpisodeProgress: jest.fn(),
    deleteEpisodeProgress: jest.fn(),
    markAllWatched: jest.fn(),
    createSeasonRating: jest.fn(),
    updateSeasonRating: jest.fn(),
    getCatalogueTvShowById: jest.fn(),
  },
  ApiClientError: class extends Error {
    public readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.status = status;
    }
  },
}));

jest.mock('@/lib/tmdb-image', () => ({
  getTmdbImageUrl: (_path: string | null | undefined, _size: string) =>
    _path ? `https://image.tmdb.org/t/p/${_size}${_path}` : null,
  getPosterPlaceholderUrl: (_title: string) =>
    `https://placehold.co/300x450?text=${encodeURIComponent(_title)}`,
  getBackdropPlaceholderUrl: () => null,
}));

// Mock Next.js Link to a plain anchor
jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = 'MockLink';
  return Link;
});

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeMovieEntry(id: string, title: string): LibraryEntryListItem {
  return {
    id,
    mediaType: 'MOVIE',
    status: 'COMPLETED',
    personalRating: 8.0,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    movie: { id: `mov-${id}`, tmdbId: 1, title, posterPath: null, releaseDate: '2020-01-01', voteAverage: 7.5 },
    tvShow: null,
    watchStats: { totalWatchCount: 1, firstWatchedAt: null, lastWatchedAt: null, episodesWatched: 0, totalEpisodes: 0, completionPercentage: 0 },
  } as unknown as LibraryEntryListItem;
}

function makePaginatedResult(items: LibraryEntryListItem[], total = items.length) {
  return {
    items,
    totalResults: total,
    page: 1,
    limit: 20,
    totalPages: Math.ceil(total / 20) || 1,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('LibraryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows the loading skeleton while fetching', async () => {
      // listLibrary never resolves during this test
      mockListLibrary.mockReturnValue(new Promise(() => {}));
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.getByTestId('loading-skeleton-grid')).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows the error state when the API rejects', async () => {
      mockListLibrary.mockRejectedValueOnce(new Error('Network error'));
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows the empty state when no items are returned', async () => {
      mockListLibrary.mockResolvedValueOnce(makePaginatedResult([]));
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      });
    });
  });

  describe('populated state', () => {
    it('renders library cards for each item', async () => {
      mockListLibrary.mockResolvedValueOnce(
        makePaginatedResult([
          makeMovieEntry('1', 'Inception'),
          makeMovieEntry('2', 'Interstellar'),
        ]),
      );
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.getByText('Inception')).toBeInTheDocument();
        expect(screen.getByText('Interstellar')).toBeInTheDocument();
      });
    });

    it('shows the total result count', async () => {
      mockListLibrary.mockResolvedValueOnce(makePaginatedResult([makeMovieEntry('1', 'Inception')], 42));
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.getByText(/42/)).toBeInTheDocument();
      });
    });
  });

  describe('page header', () => {
    it('renders the "My Library" heading', async () => {
      mockListLibrary.mockResolvedValueOnce(makePaginatedResult([]));
      render(<LibraryPage />);
      // h1 is rendered immediately
      expect(screen.getByRole('heading', { name: /my library/i })).toBeInTheDocument();
    });

    it('renders the "Discover & Add Titles" CTA link', async () => {
      mockListLibrary.mockResolvedValueOnce(makePaginatedResult([]));
      render(<LibraryPage />);
      expect(screen.getByRole('link', { name: /discover.*add titles/i })).toBeInTheDocument();
    });
  });

  describe('status filter tabs', () => {
    it('renders all five status tabs', async () => {
      mockListLibrary.mockResolvedValue(makePaginatedResult([]));
      render(<LibraryPage />);
      expect(screen.getByRole('tab', { name: 'All Titles' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Watching' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Plan to Watch' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Completed' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Dropped' })).toBeInTheDocument();
    });

    it('passes the selected status to listLibrary when a tab is clicked', async () => {
      mockListLibrary.mockResolvedValue(makePaginatedResult([]));
      render(<LibraryPage />);
      await waitFor(() => expect(mockListLibrary).toHaveBeenCalledTimes(1));

      await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: 'Watching' }));
      });

      await waitFor(() => {
        const calls = mockListLibrary.mock.calls;
        const lastCall = calls[calls.length - 1] as [{ status?: string }];
        expect(lastCall[0].status).toBe('WATCHING');
      });
    });
  });

  describe('media type filter', () => {
    it('renders media type toggle buttons', async () => {
      mockListLibrary.mockResolvedValue(makePaginatedResult([]));
      render(<LibraryPage />);
      expect(screen.getByRole('button', { name: 'All Types' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Movies' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'TV Shows' })).toBeInTheDocument();
    });
  });

  describe('pagination', () => {
    it('shows next page button when there are multiple pages', async () => {
      // 25 items in 2 pages
      mockListLibrary.mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => makeMovieEntry(String(i), `Movie ${i}`)),
        totalResults: 25,
        page: 1,
        limit: 20,
        totalPages: 2,
      });
      render(<LibraryPage />);
      await waitFor(() => {
        // 2 of 2 pages message or Next button should appear
        expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
      });
    });

    it('does not show pagination controls when there is only one page', async () => {
      mockListLibrary.mockResolvedValueOnce(makePaginatedResult([makeMovieEntry('1', 'Inception')]));
      render(<LibraryPage />);
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
      });
    });
  });
});
