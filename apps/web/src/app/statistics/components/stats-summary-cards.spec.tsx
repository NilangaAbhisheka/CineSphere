import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatsSummaryCards } from './stats-summary-cards';
import { MOCK_STATS_SUMMARY } from '../test-fixtures/stats-fixtures';

describe('StatsSummaryCards', () => {
  it('renders all 4 primary cards with exact values when data is supplied', () => {
    render(<StatsSummaryCards summary={MOCK_STATS_SUMMARY} />);

    expect(screen.getByText('Movies Completed')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();

    expect(screen.getByText('Episodes Watched')).toBeInTheDocument();
    expect(screen.getByText('182')).toBeInTheDocument();

    expect(screen.getByText('Shows Completed')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();

    expect(screen.getByText('Average Rating')).toBeInTheDocument();
    expect(screen.getByText('★ 8.2')).toBeInTheDocument();
  });

  it('renders Movie Viewings as a secondary metric distinct from Movies Completed', () => {
    render(<StatsSummaryCards summary={MOCK_STATS_SUMMARY} />);

    expect(screen.getByText(/Movie Viewings:/)).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
  });

  it('renders dash indicator when averagePersonalRating is null', () => {
    render(
      <StatsSummaryCards
        summary={{
          ...MOCK_STATS_SUMMARY,
          averagePersonalRating: null,
        }}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders unavailable dashes when summary is null (foundation state)', () => {
    render(<StatsSummaryCards summary={null} />);

    const dashes = screen.getAllByText('—');
    // 4 primary cards + 1 secondary metric = 5 dashes
    expect(dashes.length).toBe(5);
    expect(screen.getByText('Movies Completed')).toBeInTheDocument();
    expect(screen.getByText('Episodes Watched')).toBeInTheDocument();
    expect(screen.getByText('Shows Completed')).toBeInTheDocument();
    expect(screen.getByText('Average Rating')).toBeInTheDocument();
  });

  it('does not render Total Library Items', () => {
    render(<StatsSummaryCards summary={MOCK_STATS_SUMMARY} />);
    expect(screen.queryByText(/Total Library Items/i)).toBeNull();
  });
});
