/**
 * library-card.spec.tsx
 *
 * Unit tests for the LibraryCard component.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryCard } from '@/components/library-card';
import { LibraryEntryListItem } from '@cinesphere/shared';

// Silence Next.js image warnings in tests
jest.mock('@/lib/tmdb-image', () => ({
  getTmdbImageUrl: (_path: string | null | undefined, _size: string) =>
    _path ? `https://image.tmdb.org/t/p/${_size}${_path}` : null,
  getPosterPlaceholderUrl: (_title: string) =>
    `https://placehold.co/300x450?text=${encodeURIComponent(_title)}`,
}));

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeMovieEntry(overrides: Partial<LibraryEntryListItem> = {}): LibraryEntryListItem {
  return {
    id: 'lib-movie-1',
    mediaType: 'MOVIE',
    status: 'COMPLETED',
    personalRating: 8.5,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    movie: {
      id: 'mov-1',
      tmdbId: 100,
      title: 'Inception',
      posterPath: '/inception.jpg',
      releaseDate: '2010-07-16',
      voteAverage: 8.4,
    },
    tvShow: null,
    watchStats: {
      totalWatchCount: 2,
      firstWatchedAt: '2024-01-01T00:00:00Z',
      lastWatchedAt: '2025-06-01T00:00:00Z',
      episodesWatched: 0,
      totalEpisodes: 0,
      completionPercentage: 0,
    },
    ...overrides,
  } as unknown as LibraryEntryListItem;
}

function makeTvEntry(overrides: Partial<LibraryEntryListItem> = {}): LibraryEntryListItem {
  return {
    id: 'lib-tv-1',
    mediaType: 'TV',
    status: 'WATCHING',
    personalRating: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    movie: null,
    tvShow: {
      id: 'tv-1',
      tmdbId: 200,
      name: 'Breaking Bad',
      posterPath: '/breaking_bad.jpg',
      firstAirDate: '2008-01-20',
      voteAverage: 9.5,
      numberOfEpisodes: 62,
    },
    watchStats: {
      totalWatchCount: 0,
      firstWatchedAt: null,
      lastWatchedAt: null,
      episodesWatched: 31,
      totalEpisodes: 62,
      completionPercentage: 50,
    },
    ...overrides,
  } as unknown as LibraryEntryListItem;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('LibraryCard', () => {
  describe('movie entry', () => {
    it('renders the movie title', () => {
      render(<LibraryCard entry={makeMovieEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('Inception')).toBeInTheDocument();
    });

    it('shows MOVIE type badge', () => {
      render(<LibraryCard entry={makeMovieEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('Movie')).toBeInTheDocument();
    });

    it('shows the Completed status badge', () => {
      render(<LibraryCard entry={makeMovieEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('shows the personal rating badge', () => {
      render(<LibraryCard entry={makeMovieEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('8.5')).toBeInTheDocument();
    });

    it('shows watch count for movies', () => {
      render(<LibraryCard entry={makeMovieEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('Watched 2x')).toBeInTheDocument();
    });

    it('shows "Not watched yet" for movies with 0 views', () => {
      const entry = makeMovieEntry({
        watchStats: {
          totalWatchCount: 0,
          firstWatchedAt: null,
          lastWatchedAt: null,
          episodesWatched: 0,
          totalEpisodes: 0,
          completionPercentage: 0,
        },
      } as never);
      render(<LibraryCard entry={entry} onManage={jest.fn()} />);
      expect(screen.getByText('Not watched yet')).toBeInTheDocument();
    });

    it('shows the release year', () => {
      render(<LibraryCard entry={makeMovieEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('2010')).toBeInTheDocument();
    });
  });

  describe('TV entry', () => {
    it('renders the TV show name', () => {
      render(<LibraryCard entry={makeTvEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
    });

    it('shows TV type badge', () => {
      render(<LibraryCard entry={makeTvEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('TV')).toBeInTheDocument();
    });

    it('shows episode progress text', () => {
      render(<LibraryCard entry={makeTvEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('31 of 62 eps')).toBeInTheDocument();
    });

    it('shows completion percentage', () => {
      render(<LibraryCard entry={makeTvEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('shows Watching status badge', () => {
      render(<LibraryCard entry={makeTvEntry()} onManage={jest.fn()} />);
      expect(screen.getByText('Watching')).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('calls onManage when the Manage Tracking button is clicked', () => {
      const onManage = jest.fn();
      render(<LibraryCard entry={makeMovieEntry()} onManage={onManage} />);
      fireEvent.click(screen.getByRole('button', { name: /manage tracking/i }));
      expect(onManage).toHaveBeenCalledTimes(1);
      expect(onManage).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib-movie-1' }));
    });

    it('calls onManage when the card article is clicked', () => {
      const onManage = jest.fn();
      render(<LibraryCard entry={makeMovieEntry()} onManage={onManage} />);
      fireEvent.click(screen.getByTestId('library-card'));
      expect(onManage).toHaveBeenCalledTimes(1);
    });

    it('calls onManage on Enter keydown on the card', () => {
      const onManage = jest.fn();
      render(<LibraryCard entry={makeMovieEntry()} onManage={onManage} />);
      const card = screen.getByTestId('library-card');
      fireEvent.keyDown(card, { key: 'Enter' });
      expect(onManage).toHaveBeenCalledTimes(1);
    });

    it('calls onManage on Space keydown on the card', () => {
      const onManage = jest.fn();
      render(<LibraryCard entry={makeMovieEntry()} onManage={onManage} />);
      const card = screen.getByTestId('library-card');
      fireEvent.keyDown(card, { key: ' ' });
      expect(onManage).toHaveBeenCalledTimes(1);
    });
  });

  describe('notes display', () => {
    it('shows notes snippet when notes are present', () => {
      const entry = makeMovieEntry({ notes: 'Great ending' } as never);
      render(<LibraryCard entry={entry} onManage={jest.fn()} />);
      expect(screen.getByText(/Great ending/)).toBeInTheDocument();
    });

    it('does not show notes section when notes is null', () => {
      render(<LibraryCard entry={makeMovieEntry()} onManage={jest.fn()} />);
      expect(screen.queryByText(/Great ending/)).not.toBeInTheDocument();
    });
  });

  describe('no personal rating', () => {
    it('does not show rating badge when personalRating is null', () => {
      const entry = makeMovieEntry({ personalRating: null } as never);
      render(<LibraryCard entry={entry} onManage={jest.fn()} />);
      expect(screen.queryByText('★')).not.toBeInTheDocument();
    });
  });
});
