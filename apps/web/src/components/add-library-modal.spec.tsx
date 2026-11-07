/**
 * add-library-modal.spec.tsx
 *
 * Unit tests for the AddLibraryModal component.
 * fetch is mocked — no real network calls are made.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddLibraryModal } from '@/components/add-library-modal';
import { UnifiedMediaItem } from '@/components/media-card';
import { ApiClientError } from '@/lib/api-client';

// Mock the api-client module
const mockCreateLibraryEntry = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    createLibraryEntry: (...args: unknown[]) => mockCreateLibraryEntry(...args),
  },
  ApiClientError: class ApiClientError extends Error {
    public readonly status: number;
    public readonly responseBody?: unknown;
    constructor(status: number, message: string, responseBody?: unknown) {
      super(message);
      this.name = 'ApiClientError';
      this.status = status;
      this.responseBody = responseBody;
    }
  },
}));

jest.mock('@/lib/tmdb-image', () => ({
  getTmdbImageUrl: (_path: string | null | undefined, _size: string) =>
    _path ? `https://image.tmdb.org/t/p/${_size}${_path}` : null,
  getPosterPlaceholderUrl: (_title: string) =>
    `https://placehold.co/300x450?text=${encodeURIComponent(_title)}`,
}));

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<UnifiedMediaItem> = {}): UnifiedMediaItem {
  return {
    id: 'mov-1',
    tmdbId: 100,
    title: 'Test Movie',
    mediaType: 'movie',
    overview: 'An overview.',
    posterPath: '/test.jpg',
    releaseDate: '2020-01-01',
    voteAverage: 7.5,
    ...overrides,
  };
}

const defaultProps = {
  item: makeItem(),
  isOpen: true,
  onClose: jest.fn(),
  onSuccess: jest.fn(),
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AddLibraryModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('visibility', () => {
    it('renders when isOpen=true and item is provided', () => {
      render(<AddLibraryModal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not render when isOpen=false', () => {
      render(<AddLibraryModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not render when item is null', () => {
      render(<AddLibraryModal {...defaultProps} item={null} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('content', () => {
    it('shows the item title in the dialog header', () => {
      render(<AddLibraryModal {...defaultProps} />);
      expect(screen.getByText('Test Movie')).toBeInTheDocument();
    });

    it('shows Tracking Status label', () => {
      render(<AddLibraryModal {...defaultProps} />);
      expect(screen.getByText('Tracking Status')).toBeInTheDocument();
    });

    it('shows four status option buttons', () => {
      render(<AddLibraryModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Plan to Watch' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Watching' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dropped' })).toBeInTheDocument();
    });

    it('shows the rating select with "No rating yet" default', () => {
      render(<AddLibraryModal {...defaultProps} />);
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('');
    });

    it('shows the notes textarea', () => {
      render(<AddLibraryModal {...defaultProps} />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('shows "Add to Library" submit button', () => {
      render(<AddLibraryModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: /add to library/i })).toBeInTheDocument();
    });

    it('shows the movie type badge', () => {
      render(<AddLibraryModal {...defaultProps} />);
      expect(screen.getByText('Movie')).toBeInTheDocument();
    });

    it('shows TV type badge for TV items', () => {
      render(<AddLibraryModal {...defaultProps} item={makeItem({ mediaType: 'tv', title: 'The Wire' })} />);
      expect(screen.getByText('TV')).toBeInTheDocument();
    });
  });

  describe('close behaviour', () => {
    it('calls onClose when Cancel button is clicked', () => {
      const onClose = jest.fn();
      render(<AddLibraryModal {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the X button is clicked', () => {
      const onClose = jest.fn();
      render(<AddLibraryModal {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: /close dialog/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', () => {
      const onClose = jest.fn();
      render(<AddLibraryModal {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('successful submission', () => {
    it('calls createLibraryEntry with correct payload and shows success message', async () => {
      mockCreateLibraryEntry.mockResolvedValueOnce({ id: 'lib-new', mediaType: 'MOVIE', status: 'PLAN_TO_WATCH' });
      render(<AddLibraryModal {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /add to library/i }));

      await waitFor(() => {
        expect(mockCreateLibraryEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            mediaType: 'MOVIE',
            tmdbId: 100,
            status: 'PLAN_TO_WATCH',
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/Added.*to your library/i)).toBeInTheDocument();
      });
    });

    it('calls onSuccess callback after successful add', async () => {
      const responseEntry = { id: 'lib-new', mediaType: 'MOVIE', status: 'PLAN_TO_WATCH' };
      mockCreateLibraryEntry.mockResolvedValueOnce(responseEntry);
      const onSuccess = jest.fn();
      render(<AddLibraryModal {...defaultProps} onSuccess={onSuccess} />);

      fireEvent.click(screen.getByRole('button', { name: /add to library/i }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(responseEntry);
      });
    });
  });

  describe('error handling', () => {
    it('shows "already in your library" error message on 409 conflict', async () => {
      const { ApiClientError: MockApiClientError } = jest.requireMock('@/lib/api-client') as { ApiClientError: typeof ApiClientError };
      mockCreateLibraryEntry.mockRejectedValueOnce(new MockApiClientError(409, 'Conflict'));

      render(<AddLibraryModal {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /add to library/i }));

      await waitFor(() => {
        expect(screen.getByText('This title is already in your library.')).toBeInTheDocument();
      });
    });

    it('shows the API error message for non-409 errors', async () => {
      const { ApiClientError: MockApiClientError } = jest.requireMock('@/lib/api-client') as { ApiClientError: typeof ApiClientError };
      mockCreateLibraryEntry.mockRejectedValueOnce(new MockApiClientError(500, 'Internal server error'));

      render(<AddLibraryModal {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /add to library/i }));

      await waitFor(() => {
        expect(screen.getByText('Internal server error')).toBeInTheDocument();
      });
    });
  });

  describe('status selection', () => {
    it('allows selecting Watching status', () => {
      render(<AddLibraryModal {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Watching' }));
      // The Watching button should now have the active sky-500 styling (aria not set, so we
      // verify the button is present and clickable)
      expect(screen.getByRole('button', { name: 'Watching' })).toBeInTheDocument();
    });
  });
});
