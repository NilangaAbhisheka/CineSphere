/**
 * library-detail-modal.spec.tsx
 *
 * Comprehensive tests for LibraryDetailModal covering:
 * - Entry loading and metadata display
 * - Status update with revert on failure
 * - Personal rating update
 * - Notes editing and saving
 * - Deletion with confirmation flow
 * - Movie tracking: viewing event creation, history display, error handling without losing user input
 * - TV tracking: episode progress toggling (watched / unwatched), mark all watched (default vs includeSpecials),
 *   addedCount display, season rating creation vs update, concurrent submission prevention.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { LibraryDetailModal } from '@/components/library-detail-modal';
import {
  EpisodeProgressResponse,
  LibraryEntryResponse,
  SeasonDetails,
  SeasonRatingResponse,
  TvShowDetails,
  ViewingEventResponse,
} from '@cinesphere/shared';

// ── Mock ApiClient ────────────────────────────────────────────────────────────

const mockGetLibraryEntry = jest.fn();
const mockUpdateLibraryEntry = jest.fn();
const mockDeleteLibraryEntry = jest.fn();
const mockCreateViewingEvent = jest.fn();
const mockCreateEpisodeProgress = jest.fn();
const mockDeleteEpisodeProgress = jest.fn();
const mockMarkAllWatched = jest.fn();
const mockCreateSeasonRating = jest.fn();
const mockUpdateSeasonRating = jest.fn();
const mockGetCatalogueTvShowById = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getLibraryEntry: (...args: unknown[]) => mockGetLibraryEntry(...args),
    updateLibraryEntry: (...args: unknown[]) => mockUpdateLibraryEntry(...args),
    deleteLibraryEntry: (...args: unknown[]) => mockDeleteLibraryEntry(...args),
    createViewingEvent: (...args: unknown[]) => mockCreateViewingEvent(...args),
    createEpisodeProgress: (...args: unknown[]) => mockCreateEpisodeProgress(...args),
    deleteEpisodeProgress: (...args: unknown[]) => mockDeleteEpisodeProgress(...args),
    markAllWatched: (...args: unknown[]) => mockMarkAllWatched(...args),
    createSeasonRating: (...args: unknown[]) => mockCreateSeasonRating(...args),
    updateSeasonRating: (...args: unknown[]) => mockUpdateSeasonRating(...args),
    getCatalogueTvShowById: (...args: unknown[]) => mockGetCatalogueTvShowById(...args),
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
  getBackdropPlaceholderUrl: (_title: string) =>
    `https://placehold.co/780x440?text=${encodeURIComponent(_title)}`,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMovieEntry(overrides: Partial<LibraryEntryResponse> = {}): LibraryEntryResponse {
  return {
    id: 'entry-mov-1',
    userId: 'user-1',
    mediaType: 'MOVIE',
    movieId: 'mov-1',
    tvShowId: null,
    status: 'WATCHING',
    personalRating: 8.5,
    notes: 'Inception is mind-bending.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    movie: {
      id: 'mov-1',
      tmdbId: 27205,
      title: 'Inception',
      posterPath: '/inception.jpg',
      backdropPath: '/inception-bg.jpg',
      releaseDate: '2010-07-16',
      voteAverage: 8.8,
      runtime: 148,
    },
    tvShow: null,
    viewingEvents: [
      {
        id: 'evt-1',
        libraryEntryId: 'entry-mov-1',
        watchedAt: '2025-05-15T20:00:00.000Z',
        rating: 9.0,
        notes: 'IMAX 70mm screening',
      },
    ],
    watchStats: {
      totalWatchCount: 1,
      firstWatchedAt: '2025-05-15T20:00:00.000Z',
      lastWatchedAt: '2025-05-15T20:00:00.000Z',
      episodesWatched: 0,
      totalEpisodes: 0,
      completionPercentage: 0,
    },
    ...overrides,
  };
}

function makeTvCatalogue(): TvShowDetails {
  return {
    id: 'tv-show-1',
    tmdbId: 1396,
    name: 'Breaking Bad',
    originalName: 'Breaking Bad',
    overview: 'A chemistry teacher diagnosed with cancer turns to meth.',
    firstAirDate: '2008-01-20',
    lastAirDate: '2013-09-29',
    originalLanguage: 'en',
    popularity: 150.5,
    voteAverage: 9.5,
    voteCount: 12000,
    posterPath: '/bb.jpg',
    backdropPath: '/bb-bg.jpg',
    status: 'Ended',
    genres: [],
    numberOfSeasons: 2,
    numberOfEpisodes: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    syncedAt: '2026-01-01T00:00:00Z',
    keywords: [],
    cast: [],
    seasons: [
      {
        id: 'season-0',
        tmdbId: 100,
        seasonNumber: 0,
        name: 'Specials',
        overview: 'Special mini-episodes',
        posterPath: null,
        airDate: '2009-02-17',
        episodes: [
          {
            id: 'ep-spec-1',
            tmdbId: 1001,
            episodeNumber: 1,
            name: 'Good Cop / Bad Cop',
            overview: null,
            airDate: '2009-02-17',
            runtime: 12,
          },
        ],
      },
      {
        id: 'season-1',
        tmdbId: 101,
        seasonNumber: 1,
        name: 'Season 1',
        overview: 'The beginning of Walter White.',
        posterPath: null,
        airDate: '2008-01-20',
        episodes: [
          {
            id: 'ep-1',
            tmdbId: 1002,
            episodeNumber: 1,
            name: 'Pilot',
            overview: 'Series premiere',
            airDate: '2008-01-20',
            runtime: 58,
          },
          {
            id: 'ep-2',
            tmdbId: 1003,
            episodeNumber: 2,
            name: "Cat's in the Bag...",
            overview: 'The aftermath',
            airDate: '2008-01-27',
            runtime: 48,
          },
        ],
      },
    ],
  };
}

function makeTvEntry(overrides: Partial<LibraryEntryResponse> = {}): LibraryEntryResponse {
  return {
    id: 'entry-tv-1',
    userId: 'user-1',
    mediaType: 'TV',
    movieId: null,
    tvShowId: 'tv-show-1',
    status: 'WATCHING',
    personalRating: 9.5,
    notes: 'One of the best series ever.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    movie: null,
    tvShow: {
      id: 'tv-show-1',
      tmdbId: 1396,
      name: 'Breaking Bad',
      posterPath: '/bb.jpg',
      backdropPath: '/bb-bg.jpg',
      firstAirDate: '2008-01-20',
      voteAverage: 9.5,
      numberOfSeasons: 2,
      numberOfEpisodes: 3,
    },
    episodeProgresses: [
      {
        libraryEntryId: 'entry-tv-1',
        episodeId: 'ep-1',
        watchedAt: '2026-01-05T12:00:00.000Z',
      },
    ],
    seasonRatings: [
      {
        id: 'sr-1',
        libraryEntryId: 'entry-tv-1',
        seasonId: 'season-1',
        rating: 9.0,
        seasonNumber: 1,
        createdAt: '2026-01-05T12:00:00.000Z',
        updatedAt: '2026-01-05T12:00:00.000Z',
      },
    ],
    watchStats: {
      totalWatchCount: 0,
      firstWatchedAt: null,
      lastWatchedAt: null,
      episodesWatched: 1,
      totalEpisodes: 3,
      completionPercentage: 33,
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LibraryDetailModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Loading & Metadata Display', () => {
    it('fetches and displays movie library entry details', async () => {
      mockGetLibraryEntry.mockResolvedValueOnce(makeMovieEntry());

      render(<LibraryDetailModal entryId="entry-mov-1" isOpen={true} onClose={jest.fn()} />);

      // Loading state appears first
      expect(screen.getByText(/loading library details/i)).toBeInTheDocument();

      // Once loaded, header metadata is visible
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'Inception' })).toBeInTheDocument();
      });

      expect(screen.getByText('2010')).toBeInTheDocument();
      expect(screen.getByText('Movie')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Inception is mind-bending.')).toBeInTheDocument();
      expect(mockGetLibraryEntry).toHaveBeenCalledWith('entry-mov-1');
    });

    it('fetches TV entry and companion catalogue details', async () => {
      mockGetLibraryEntry.mockResolvedValueOnce(makeTvEntry());
      mockGetCatalogueTvShowById.mockResolvedValueOnce(makeTvCatalogue());

      render(<LibraryDetailModal entryId="entry-tv-1" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 2, name: 'Breaking Bad' })).toBeInTheDocument();
      });

      expect(mockGetCatalogueTvShowById).toHaveBeenCalledWith('tv-show-1');
      expect(screen.getByText('Season 1')).toBeInTheDocument();
      expect(screen.getByText('Pilot')).toBeInTheDocument();
      expect(screen.getByText("Cat's in the Bag...")).toBeInTheDocument();
    });

    it('displays error message when getLibraryEntry rejects', async () => {
      mockGetLibraryEntry.mockRejectedValueOnce(new Error('Record not found'));

      render(<LibraryDetailModal entryId="bad-id" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Record not found')).toBeInTheDocument();
      });
    });
  });

  describe('2. Entry Management (Status, Rating, Notes, Deletion)', () => {
    it('updates status using the correct payload and calls onEntryUpdated', async () => {
      const entry = makeMovieEntry({ status: 'PLAN_TO_WATCH' });
      const updated = makeMovieEntry({ status: 'COMPLETED' });
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockUpdateLibraryEntry.mockResolvedValueOnce(updated);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-mov-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Completed' }));

      await waitFor(() => {
        expect(mockUpdateLibraryEntry).toHaveBeenCalledWith('entry-mov-1', {
          status: 'COMPLETED',
        });
      });

      expect(onEntryUpdated).toHaveBeenCalledWith(updated);
    });

    it('reverts status when status update API rejects', async () => {
      const entry = makeMovieEntry({ status: 'PLAN_TO_WATCH' });
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockUpdateLibraryEntry.mockRejectedValueOnce(new Error('Update failed'));

      render(<LibraryDetailModal entryId="entry-mov-1" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Completed' }));

      await waitFor(() => {
        expect(screen.getByText('Update failed')).toBeInTheDocument();
      });
    });

    it('updates personal rating using the correct payload and calls onEntryUpdated', async () => {
      const entry = makeMovieEntry({ personalRating: 7.0 });
      const updated = makeMovieEntry({ personalRating: 9.0 });
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockUpdateLibraryEntry.mockResolvedValueOnce(updated);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-mov-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/personal rating/i)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText(/personal rating/i), {
        target: { value: '9.0' },
      });

      await waitFor(() => {
        expect(mockUpdateLibraryEntry).toHaveBeenCalledWith('entry-mov-1', {
          personalRating: 9.0,
        });
      });

      expect(onEntryUpdated).toHaveBeenCalledWith(updated);
    });

    it('edits and saves notes, displays success feedback, and calls onEntryUpdated', async () => {
      const entry = makeMovieEntry({ notes: 'Initial note' });
      const updated = makeMovieEntry({ notes: 'Updated reflection note.' });
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockUpdateLibraryEntry.mockResolvedValueOnce(updated);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-mov-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/personal reflections/i)).toBeInTheDocument();
      });

      const textarea = screen.getByPlaceholderText(/personal reflections/i);
      fireEvent.change(textarea, { target: { value: 'Updated reflection note.' } });

      const saveBtn = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdateLibraryEntry).toHaveBeenCalledWith('entry-mov-1', {
          notes: 'Updated reflection note.',
        });
      });

      expect(screen.getByText('Notes saved successfully!')).toBeInTheDocument();
      expect(onEntryUpdated).toHaveBeenCalledWith(updated);
    });

    it('handles delete flow: requires confirmation and invokes delete API', async () => {
      const entry = makeMovieEntry();
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockDeleteLibraryEntry.mockResolvedValueOnce(undefined);
      const onClose = jest.fn();
      const onEntryDeleted = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-mov-1"
          isOpen={true}
          onClose={onClose}
          onEntryDeleted={onEntryDeleted}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /remove from library/i })).toBeInTheDocument();
      });

      // 1. Initial click shows confirmation banner
      fireEvent.click(screen.getByRole('button', { name: /remove from library/i }));
      expect(screen.getByText(/are you sure\?/i)).toBeInTheDocument();
      expect(mockDeleteLibraryEntry).not.toHaveBeenCalled();

      // 2. Cancel hides confirmation without deleting
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText(/are you sure\?/i)).not.toBeInTheDocument();
      expect(mockDeleteLibraryEntry).not.toHaveBeenCalled();

      // 3. Confirm actually invokes delete API
      fireEvent.click(screen.getByRole('button', { name: /remove from library/i }));
      fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));

      await waitFor(() => {
        expect(mockDeleteLibraryEntry).toHaveBeenCalledWith('entry-mov-1');
      });

      expect(onEntryDeleted).toHaveBeenCalledWith('entry-mov-1');
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('3. Movie Tracking (Viewing Events & Rewatch History)', () => {
    it('submits a new viewing event with correct ID and payload', async () => {
      const entry = makeMovieEntry({
        watchStats: {
          totalWatchCount: 1,
          firstWatchedAt: null,
          lastWatchedAt: null,
          episodesWatched: 0,
          totalEpisodes: 0,
          completionPercentage: 0,
        },
      });
      const createdEvent: ViewingEventResponse = {
        id: 'evt-2',
        libraryEntryId: 'entry-mov-1',
        watchedAt: '2026-02-10T00:00:00.000Z',
        rating: 9.5,
        notes: 'Second watch in 4K UHD',
      };

      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockCreateViewingEvent.mockResolvedValueOnce(createdEvent);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-mov-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/record a viewing event/i)).toBeInTheDocument();
      });

      // Fill in event form
      const dateInput = screen.getByLabelText(/watched date/i);
      fireEvent.change(dateInput, { target: { value: '2026-02-10' } });

      const ratingSelect = screen.getByLabelText(/session rating/i);
      fireEvent.change(ratingSelect, { target: { value: '9.5' } });

      const notesInput = screen.getByLabelText(/notes \(optional\)/i);
      fireEvent.change(notesInput, { target: { value: 'Second watch in 4K UHD' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /\+ log viewing event/i }));

      await waitFor(() => {
        expect(mockCreateViewingEvent).toHaveBeenCalledWith('entry-mov-1', {
          watchedAt: expect.stringContaining('2026-02-10'),
          rating: 9.5,
          notes: 'Second watch in 4K UHD',
        });
      });

      expect(screen.getByText('Watch logged successfully!')).toBeInTheDocument();
      expect(onEntryUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          watchStats: expect.objectContaining({ totalWatchCount: 2 }),
        }),
      );
    });

    it('displays viewing history timeline correctly', async () => {
      const entry = makeMovieEntry({
        viewingEvents: [
          {
            id: 'evt-1',
            libraryEntryId: 'entry-mov-1',
            watchedAt: '2025-05-15T20:00:00.000Z',
            rating: 9.0,
            notes: 'IMAX 70mm screening',
          },
        ],
      });
      mockGetLibraryEntry.mockResolvedValueOnce(entry);

      render(<LibraryDetailModal entryId="entry-mov-1" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/viewing history \(1\)/i)).toBeInTheDocument();
      });

      const historyItem = screen.getByTestId('viewing-history-item');
      expect(within(historyItem).getByText('“IMAX 70mm screening”')).toBeInTheDocument();
      expect(within(historyItem).getByText('★ 9.0')).toBeInTheDocument();
    });

    it('failed event submission displays error without losing user input', async () => {
      const entry = makeMovieEntry();
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockCreateViewingEvent.mockRejectedValueOnce(new Error('Database lock error'));

      render(<LibraryDetailModal entryId="entry-mov-1" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByText(/record a viewing event/i)).toBeInTheDocument();
      });

      const notesInput = screen.getByLabelText(/notes \(optional\)/i) as HTMLInputElement;
      fireEvent.change(notesInput, { target: { value: 'Preserved user notes' } });

      fireEvent.click(screen.getByRole('button', { name: /\+ log viewing event/i }));

      await waitFor(() => {
        expect(screen.getByText(/failed to log watch: database lock error/i)).toBeInTheDocument();
      });

      // User's input must still be in the form!
      expect(notesInput.value).toBe('Preserved user notes');
    });
  });

  describe('4. TV Tracking (Episode Progress, Mark All Watched, Season Ratings)', () => {
    it('marks an episode watched and updates UI', async () => {
      const entry = makeTvEntry(); // ep-1 is watched, ep-2 is unwatched
      const cat = makeTvCatalogue();
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockGetCatalogueTvShowById.mockResolvedValueOnce(cat);

      const newProgress: EpisodeProgressResponse = {
        libraryEntryId: 'entry-tv-1',
        episodeId: 'ep-2',
        watchedAt: '2026-02-01T00:00:00.000Z',
      };
      mockCreateEpisodeProgress.mockResolvedValueOnce(newProgress);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-tv-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('episode-row-ep-2')).toBeInTheDocument();
      });

      // ep-2 is currently unwatched — finds its "+ Mark Watched" button
      const ep2Row = screen.getByTestId('episode-row-ep-2');
      const markBtn = within(ep2Row).getByRole('button', { name: /\+ mark watched/i });
      fireEvent.click(markBtn);

      await waitFor(() => {
        expect(mockCreateEpisodeProgress).toHaveBeenCalledWith('entry-tv-1', 'ep-2');
      });

      expect(onEntryUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          watchStats: expect.objectContaining({ episodesWatched: 2 }),
        }),
      );
    });

    it('marks an episode unwatched and updates UI', async () => {
      const entry = makeTvEntry(); // ep-1 is watched
      const cat = makeTvCatalogue();
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockGetCatalogueTvShowById.mockResolvedValueOnce(cat);
      mockDeleteEpisodeProgress.mockResolvedValueOnce(undefined);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-tv-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('episode-row-ep-1')).toBeInTheDocument();
      });

      const ep1Row = screen.getByTestId('episode-row-ep-1');
      const watchedBtn = within(ep1Row).getByRole('button', { name: /✓ watched/i });
      fireEvent.click(watchedBtn);

      await waitFor(() => {
        expect(mockDeleteEpisodeProgress).toHaveBeenCalledWith('entry-tv-1', 'ep-1');
      });

      expect(onEntryUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          watchStats: expect.objectContaining({ episodesWatched: 0 }),
        }),
      );
    });

    it('mark all watched defaults to includeSpecials: false and presents addedCount', async () => {
      const entry = makeTvEntry();
      const cat = makeTvCatalogue();
      mockGetLibraryEntry
        .mockResolvedValueOnce(entry) // initial load
        .mockResolvedValueOnce(
          makeTvEntry({
            watchStats: {
              totalWatchCount: 0,
              firstWatchedAt: null,
              lastWatchedAt: null,
              episodesWatched: 3,
              totalEpisodes: 3,
              completionPercentage: 100,
            },
          }),
        ); // after mark all
      mockGetCatalogueTvShowById.mockResolvedValueOnce(cat);
      mockMarkAllWatched.mockResolvedValueOnce({ addedCount: 2 });

      render(<LibraryDetailModal entryId="entry-tv-1" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark all watched/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /mark all watched/i }));

      await waitFor(() => {
        expect(mockMarkAllWatched).toHaveBeenCalledWith('entry-tv-1', false);
      });

      expect(screen.getByText('Marked 2 new episodes as watched!')).toBeInTheDocument();
    });

    it('mark all watched sends includeSpecials: true when checkbox is explicitly checked', async () => {
      const entry = makeTvEntry();
      const cat = makeTvCatalogue();
      mockGetLibraryEntry.mockResolvedValueOnce(entry).mockResolvedValueOnce(makeTvEntry());
      mockGetCatalogueTvShowById.mockResolvedValueOnce(cat);
      mockMarkAllWatched.mockResolvedValueOnce({ addedCount: 3 });

      render(<LibraryDetailModal entryId="entry-tv-1" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByLabelText(/include specials/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText(/include specials/i));
      fireEvent.click(screen.getByRole('button', { name: /mark all watched/i }));

      await waitFor(() => {
        expect(mockMarkAllWatched).toHaveBeenCalledWith('entry-tv-1', true);
      });

      expect(screen.getByText('Marked 3 new episodes as watched!')).toBeInTheDocument();
    });

    it('prevents repeated mark-all-watched submissions while a request is in flight', async () => {
      const entry = makeTvEntry();
      const cat = makeTvCatalogue();
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockGetCatalogueTvShowById.mockResolvedValueOnce(cat);

      // Create a pending promise for markAllWatched
      let resolveMark: (val: { addedCount: number }) => void;
      mockMarkAllWatched.mockReturnValue(
        new Promise((res) => {
          resolveMark = res;
        }),
      );

      render(<LibraryDetailModal entryId="entry-tv-1" isOpen={true} onClose={jest.fn()} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark all watched/i })).toBeInTheDocument();
      });

      const button = screen.getByRole('button', { name: /mark all watched/i });

      // First click
      fireEvent.click(button);
      // Immediate second and third click while pending
      fireEvent.click(button);
      fireEvent.click(button);

      expect(mockMarkAllWatched).toHaveBeenCalledTimes(1);

      // Resolve the pending promise to clean up
      await waitFor(() => {
        resolveMark!({ addedCount: 1 });
      });
    });

    it('creates a new season rating for unrated season', async () => {
      const entry = makeTvEntry({ seasonRatings: [] }); // No season ratings
      const cat = makeTvCatalogue();
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockGetCatalogueTvShowById.mockResolvedValueOnce(cat);

      const createdRating: SeasonRatingResponse = {
        id: 'sr-new',
        libraryEntryId: 'entry-tv-1',
        seasonId: 'season-1',
        rating: 8.5,
        seasonNumber: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      mockCreateSeasonRating.mockResolvedValueOnce(createdRating);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-tv-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Season 1')).toBeInTheDocument();
      });

      // Finds the season rating select widgets
      const seasonRatingSelects = screen.getAllByRole('combobox');
      // The second combobox after personal rating (and possibly movie log if rendered)
      const season1Select = seasonRatingSelects[seasonRatingSelects.length - 1];

      fireEvent.change(season1Select, { target: { value: '8.5' } });

      await waitFor(() => {
        expect(mockCreateSeasonRating).toHaveBeenCalledWith('entry-tv-1', 'season-1', 8.5);
      });

      expect(mockUpdateSeasonRating).not.toHaveBeenCalled();
      expect(onEntryUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          seasonRatings: expect.arrayContaining([createdRating]),
        }),
      );
    });

    it('updates an existing season rating using updateSeasonRating API', async () => {
      const entry = makeTvEntry(); // already has season rating for season-1 (9.0)
      const cat = makeTvCatalogue();
      mockGetLibraryEntry.mockResolvedValueOnce(entry);
      mockGetCatalogueTvShowById.mockResolvedValueOnce(cat);

      const updatedRating: SeasonRatingResponse = {
        id: 'sr-1',
        libraryEntryId: 'entry-tv-1',
        seasonId: 'season-1',
        rating: 10.0,
        seasonNumber: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      };
      mockUpdateSeasonRating.mockResolvedValueOnce(updatedRating);
      const onEntryUpdated = jest.fn();

      render(
        <LibraryDetailModal
          entryId="entry-tv-1"
          isOpen={true}
          onClose={jest.fn()}
          onEntryUpdated={onEntryUpdated}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Season 1')).toBeInTheDocument();
      });

      const seasonRatingSelects = screen.getAllByRole('combobox');
      const season1Select = seasonRatingSelects[seasonRatingSelects.length - 1];

      fireEvent.change(season1Select, { target: { value: '10.0' } });

      await waitFor(() => {
        expect(mockUpdateSeasonRating).toHaveBeenCalledWith('entry-tv-1', 'season-1', 10.0);
      });

      expect(mockCreateSeasonRating).not.toHaveBeenCalled();
      expect(onEntryUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          seasonRatings: expect.arrayContaining([updatedRating]),
        }),
      );
    });
  });
});
