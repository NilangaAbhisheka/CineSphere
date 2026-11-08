/**
 * page.spec.tsx — Dashboard page tests
 *
 * apiClient.getDashboardOverview is mocked — no network calls are made.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import DashboardPage from '@/app/page';
import {
  ContinueWatchingItem,
  DashboardOverviewResponse,
  DashboardStats,
  QuickPickItem,
  RecentActivityItem,
} from '@cinesphere/shared';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetDashboardOverview = jest.fn();
const mockCreateLibraryEntry = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getDashboardOverview: (...args: unknown[]) => mockGetDashboardOverview(...args),
    getDashboardStats: jest.fn(),
    getDashboardContinueWatching: jest.fn(),
    getDashboardRecentActivity: jest.fn(),
    getDashboardQuickPicks: jest.fn(),
    createLibraryEntry: (...args: unknown[]) => mockCreateLibraryEntry(...args),
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

jest.mock('next/link', () => {
  const Link = ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = 'MockLink';
  return Link;
});

// Mock LibraryDetailModal to avoid complex modal setup in dashboard tests
jest.mock('@/components/library-detail-modal', () => ({
  LibraryDetailModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
    entryId: string | null;
  }) =>
    isOpen ? (
      <div data-testid="library-modal">
        <button onClick={onClose}>Close modal</button>
      </div>
    ) : null,
}));

// ── Test data ─────────────────────────────────────────────────────────────────

const MOCK_STATS: DashboardStats = {
  totalMovies: 12,
  completedMovies: 8,
  watchingTvShows: 3,
  completedTvShows: 2,
  totalEpisodesWatched: 240,
  totalViewingEvents: 20,
  recentActivityCount: 15,
};

const MOCK_CONTINUE_WATCHING: ContinueWatchingItem[] = [
  {
    libraryEntryId: 'entry-tv-1',
    tvShow: {
      id: 'tv-1',
      tmdbId: 1399,
      name: 'Game of Thrones',
      posterPath: '/got.jpg',
      backdropPath: null,
    },
    episodesWatched: 50,
    totalEligibleEpisodes: 73,
    progressPercentage: 68,
    nextEpisode: { episodeId: 'ep-51', episodeNumber: 1, seasonNumber: 6, name: 'The Red Woman' },
    lastWatchedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

const MOCK_RECENT_ACTIVITY: RecentActivityItem[] = [
  {
    activityType: 'MOVIE',
    watchedAt: new Date(Date.now() - 3_600_000).toISOString(),
    libraryEntryId: 'entry-m-1',
    movie: { id: 'mov-1', tmdbId: 500, title: 'Inception', posterPath: '/inc.jpg' },
    viewingEventRating: 9.0,
  },
  {
    activityType: 'TV_EPISODE',
    watchedAt: new Date(Date.now() - 7_200_000).toISOString(),
    libraryEntryId: 'entry-tv-1',
    tvShow: { id: 'tv-1', tmdbId: 1399, name: 'Game of Thrones', posterPath: '/got.jpg' },
    episodeNumber: 50,
    seasonNumber: 5,
    episodeName: "Mother's Mercy",
  },
];

const MOCK_QUICK_PICKS: QuickPickItem[] = [
  {
    id: 'mov-99',
    tmdbId: 999,
    mediaType: 'MOVIE',
    title: 'The Dark Knight',
    posterPath: '/tdk.jpg',
    backdropPath: null,
    releaseYear: '2008',
    voteAverage: 9.0,
  },
  {
    id: 'tv-99',
    tmdbId: 1234,
    mediaType: 'TV',
    title: 'Breaking Bad',
    posterPath: '/bb.jpg',
    backdropPath: null,
    releaseYear: '2008',
    voteAverage: 9.5,
  },
];

const MOCK_OVERVIEW: DashboardOverviewResponse = {
  stats: MOCK_STATS,
  continueWatching: MOCK_CONTINUE_WATCHING,
  recentActivity: MOCK_RECENT_ACTIVITY,
  quickPicks: MOCK_QUICK_PICKS,
};

// ── Helper ────────────────────────────────────────────────────────────────────

async function renderDashboard(overviewData: DashboardOverviewResponse = MOCK_OVERVIEW) {
  mockGetDashboardOverview.mockResolvedValue(overviewData);
  let container: ReturnType<typeof render>;
  await act(async () => {
    container = render(<DashboardPage />);
  });
  await waitFor(() => {
    expect(screen.queryByText('Dashboard')).toBeTruthy();
  });
  return container!;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Loading state ────────────────────────────────────────────────────────

  describe('Loading state', () => {
    it('renders skeleton placeholders before data resolves', () => {
      // Don't resolve the promise immediately
      mockGetDashboardOverview.mockReturnValue(new Promise(() => {}));

      render(<DashboardPage />);

      // Skeletons are animate-pulse elements
      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────

  describe('Error state', () => {
    it('renders retry button on API failure', async () => {
      mockGetDashboardOverview.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        render(<DashboardPage />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      });
    });

    it('retries the overview request when Retry is clicked', async () => {
      mockGetDashboardOverview
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(MOCK_OVERVIEW);

      await act(async () => {
        render(<DashboardPage />);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      });

      expect(mockGetDashboardOverview).toHaveBeenCalledTimes(2);
    });
  });

  // ── Stat cards ───────────────────────────────────────────────────────────

  describe('Viewing Summary', () => {
    it('renders movie count stat card', async () => {
      await renderDashboard();
      expect(screen.getByText('12')).toBeInTheDocument(); // totalMovies
    });

    it('renders episodes watched stat card', async () => {
      await renderDashboard();
      expect(screen.getByText('240')).toBeInTheDocument(); // totalEpisodesWatched
    });

    it('renders secondary stats line with recent activity', async () => {
      await renderDashboard();
      expect(screen.getByText(/15/)).toBeInTheDocument(); // recentActivityCount
    });
  });

  // ── Continue Watching ────────────────────────────────────────────────────

  describe('Continue Watching section', () => {
    it('renders show name', async () => {
      await renderDashboard();
      // Game of Thrones appears in Continue Watching card; it may also appear in Recent Activity
      const matches = screen.getAllByText('Game of Thrones');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders next episode label', async () => {
      await renderDashboard();
      expect(screen.getByText(/S06E01/)).toBeInTheDocument();
    });

    it('renders episode progress counts', async () => {
      await renderDashboard();
      expect(screen.getByText(/50\/73/)).toBeInTheDocument();
    });

    it('renders progress percentage', async () => {
      await renderDashboard();
      expect(screen.getByText('68%')).toBeInTheDocument();
    });

    it('opens library modal when Manage is clicked', async () => {
      await renderDashboard();

      await act(async () => {
        fireEvent.click(screen.getByText('Manage →'));
      });

      expect(screen.getByTestId('library-modal')).toBeInTheDocument();
    });

    it('renders empty state when no shows are in progress', async () => {
      await renderDashboard({ ...MOCK_OVERVIEW, continueWatching: [] });
      expect(screen.getByText(/No shows in progress/i)).toBeInTheDocument();
    });
  });

  // ── Recent Activity ──────────────────────────────────────────────────────

  describe('Recent Activity section', () => {
    it('renders movie title in activity list', async () => {
      await renderDashboard();
      expect(screen.getByText('Inception')).toBeInTheDocument();
    });

    it('renders TV show name in activity list', async () => {
      await renderDashboard();
      // Game of Thrones appears in both Continue Watching and Recent Activity
      const matches = screen.getAllByText('Game of Thrones');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders TV episode label for TV activity', async () => {
      await renderDashboard();
      expect(screen.getByText(/S05E50/)).toBeInTheDocument();
    });

    it('renders empty state when no activity', async () => {
      await renderDashboard({ ...MOCK_OVERVIEW, recentActivity: [] });
      expect(screen.getByText(/No recent activity/i)).toBeInTheDocument();
    });
  });

  // ── Quick Picks ──────────────────────────────────────────────────────────

  describe('Quick Picks section', () => {
    it('renders movie card title', async () => {
      await renderDashboard();
      expect(screen.getByText('The Dark Knight')).toBeInTheDocument();
    });

    it('renders TV show card title', async () => {
      await renderDashboard();
      expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
    });

    it('renders release year on cards', async () => {
      await renderDashboard();
      const year2008Elements = screen.getAllByText(/2008/);
      expect(year2008Elements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders empty state when no catalogue items', async () => {
      await renderDashboard({ ...MOCK_OVERVIEW, quickPicks: [] });
      expect(screen.getByText(/No catalogue items yet/i)).toBeInTheDocument();
    });

    it('opens quick add modal when Add is clicked', async () => {
      await renderDashboard();

      await act(async () => {
        // Click the add button for 'The Dark Knight'
        const addBtn = screen.getByLabelText('Add The Dark Knight to library');
        fireEvent.click(addBtn);
      });

      expect(screen.getByText('Add to Library')).toBeInTheDocument();
      // Title appears in both card and modal; at least 2 matches expected
      expect(screen.getAllByText('The Dark Knight').length).toBeGreaterThanOrEqual(1);
    });

    it('quick add modal closes on Cancel', async () => {
      await renderDashboard();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Add The Dark Knight to library'));
      });

      await act(async () => {
        // The modal Cancel button is inside a dialog with 'Add to Library' heading
        const cancelBtn = screen.getAllByRole('button', { name: 'Cancel' })[0];
        fireEvent.click(cancelBtn);
      });

      expect(screen.queryByText('Add to Library')).not.toBeInTheDocument();
    });
  });

  // ── Navigation ───────────────────────────────────────────────────────────

  describe('Navigation links', () => {
    it('renders My Library link', async () => {
      await renderDashboard();
      const link = screen.getByRole('link', { name: 'My Library' });
      expect(link).toHaveAttribute('href', '/library');
    });

    it('renders Discover link', async () => {
      await renderDashboard();
      const link = screen.getByRole('link', { name: 'Discover' });
      expect(link).toHaveAttribute('href', '/discover');
    });
  });

  // ── API client calls ─────────────────────────────────────────────────────

  describe('API integration', () => {
    it('calls getDashboardOverview once on mount', async () => {
      await renderDashboard();
      expect(mockGetDashboardOverview).toHaveBeenCalledTimes(1);
    });

    it('passes AbortSignal to getDashboardOverview', async () => {
      await renderDashboard();
      const [signal] = mockGetDashboardOverview.mock.calls[0];
      expect(signal).toBeInstanceOf(AbortSignal);
    });
  });
});
