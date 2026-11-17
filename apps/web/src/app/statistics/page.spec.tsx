/**
 * page.spec.tsx — Statistics page tests (Stage 4.3 Live Integration)
 *
 * apiClient stats methods are mocked — no network calls are made.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import StatisticsPage from './page';
import {
  MOCK_STATS_SUMMARY,
  MOCK_GENRE_STATS,
  MOCK_ACTIVITY_TIMELINE,
  MOCK_RATING_STATS,
} from './test-fixtures/stats-fixtures';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetStatsOverview = jest.fn();
const mockGetStatsGenres = jest.fn();
const mockGetStatsActivity = jest.fn();
const mockGetStatsRatings = jest.fn();

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getStatsOverview: (...args: unknown[]) => mockGetStatsOverview(...args),
    getStatsGenres: (...args: unknown[]) => mockGetStatsGenres(...args),
    getStatsActivity: (...args: unknown[]) => mockGetStatsActivity(...args),
    getStatsRatings: (...args: unknown[]) => mockGetStatsRatings(...args),
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

describe('StatisticsPage — Live Integration (Stage 4.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStatsOverview.mockResolvedValue(MOCK_STATS_SUMMARY);
    mockGetStatsGenres.mockResolvedValue(MOCK_GENRE_STATS);
    mockGetStatsActivity.mockResolvedValue(MOCK_ACTIVITY_TIMELINE);
    mockGetStatsRatings.mockResolvedValue(MOCK_RATING_STATS);
  });

  it('renders page header title and subtitle', async () => {
    render(<StatisticsPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Statistics' })).toBeInTheDocument();
    expect(
      screen.getByText('Personal viewing analytics and tracking intelligence.'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId('statistics-skeleton')).not.toBeInTheDocument();
    });
  });

  it('renders loading skeleton while statistics are being fetched', async () => {
    // Return unresolved promises to freeze loading state
    mockGetStatsOverview.mockReturnValue(new Promise(() => {}));
    mockGetStatsGenres.mockReturnValue(new Promise(() => {}));
    mockGetStatsActivity.mockReturnValue(new Promise(() => {}));
    mockGetStatsRatings.mockReturnValue(new Promise(() => {}));

    render(<StatisticsPage />);

    expect(screen.getByTestId('statistics-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Loading viewing statistics...')).toBeInTheDocument();
  });

  it('fetches all 4 endpoints concurrently and renders live statistics', async () => {
    render(<StatisticsPage />);

    await waitFor(() => {
      expect(screen.queryByTestId('statistics-skeleton')).not.toBeInTheDocument();
    });

    // Verify all 4 endpoints were called
    expect(mockGetStatsOverview).toHaveBeenCalledTimes(1);
    expect(mockGetStatsGenres).toHaveBeenCalledTimes(1);
    expect(mockGetStatsActivity).toHaveBeenCalledTimes(1);
    expect(mockGetStatsRatings).toHaveBeenCalledTimes(1);

    // Verify live summary card values are displayed
    const summarySection = screen.getByRole('region', { name: /Viewing Summary/i });
    expect(summarySection).toHaveTextContent('Movies Completed');
    expect(summarySection).toHaveTextContent('14');
    expect(summarySection).toHaveTextContent('Episodes Watched');
    expect(summarySection).toHaveTextContent('182');
    expect(summarySection).toHaveTextContent('Shows Completed');
    expect(summarySection).toHaveTextContent('6');
    expect(summarySection).toHaveTextContent('Average Rating');
    expect(summarySection).toHaveTextContent('★ 8.2');
    expect(summarySection).toHaveTextContent('Movie Viewings: 19');

    // Verify Phase 3.7 foundation notice is NOT displayed
    expect(screen.queryByText(/Statistics Foundation \(Phase 3.7\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(Analytics will connect in Phase 4\)/i)).not.toBeInTheDocument();

    // Verify genre chart renders live data
    expect(screen.getByRole('region', { name: /Genre Distribution/i })).toBeInTheDocument();
    expect(screen.getAllByText('Science Fiction').length).toBeGreaterThanOrEqual(1);

    // Verify activity chart renders live months
    expect(screen.getByRole('region', { name: /Viewing Activity Timeline/i })).toBeInTheDocument();
    expect(screen.getByText('May')).toBeInTheDocument();
    expect(screen.getByText('Oct')).toBeInTheDocument();

    // Verify rating chart renders live distribution
    const ratingSection = screen.getByRole('region', {
      name: /Personal Rating Distribution/i,
    });
    expect(ratingSection).toHaveTextContent('Total Rated: 23');
    expect(ratingSection).toHaveTextContent('Unrated Entries: 5');
  });

  it('renders error state when an API request fails', async () => {
    mockGetStatsOverview.mockRejectedValue(new Error('Network error: server unreachable'));

    render(<StatisticsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    expect(screen.getByText('Unable to Load Data')).toBeInTheDocument();
    expect(screen.getByText('Network error: server unreachable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();

    // Data sections should not be displayed when error occurs
    expect(screen.queryByText('Movies Completed')).not.toBeInTheDocument();
  });

  it('allows user to retry after an error and displays live data on recovery', async () => {
    mockGetStatsOverview.mockRejectedValueOnce(new Error('Temporary 503 error'));

    render(<StatisticsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /Try Again/i });
    expect(retryButton).toBeInTheDocument();

    // Now mock succeeds on retry
    mockGetStatsOverview.mockResolvedValueOnce(MOCK_STATS_SUMMARY);

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
      expect(screen.getByText('14')).toBeInTheDocument();
    });

    expect(mockGetStatsOverview).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Movies Completed')).toBeInTheDocument();
  });

  it('handles null averagePersonalRating without fabricated values', async () => {
    mockGetStatsOverview.mockResolvedValue({
      ...MOCK_STATS_SUMMARY,
      averagePersonalRating: null,
    });

    render(<StatisticsPage />);

    await waitFor(() => {
      expect(screen.queryByTestId('statistics-skeleton')).not.toBeInTheDocument();
    });

    // Rating card should display dash, not 0.0
    expect(screen.getByText('Average Rating')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('★ 0.0')).not.toBeInTheDocument();
  });

  it('handles empty genre distribution gracefully', async () => {
    mockGetStatsGenres.mockResolvedValue([]);

    render(<StatisticsPage />);

    await waitFor(() => {
      expect(screen.queryByTestId('statistics-skeleton')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Genre Breakdown')).toBeInTheDocument();
    expect(screen.getByText('No completed titles')).toBeInTheDocument();
    expect(screen.getByText(/No completed titles with genres found/i)).toBeInTheDocument();
  });
});
