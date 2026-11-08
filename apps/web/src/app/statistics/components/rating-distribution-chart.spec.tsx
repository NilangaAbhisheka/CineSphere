import React from 'react';
import { render, screen } from '@testing-library/react';
import { RatingDistributionChart } from './rating-distribution-chart';
import { MOCK_RATING_STATS } from '../test-fixtures/stats-fixtures';

describe('RatingDistributionChart', () => {
  it('renders all 19 half-step rating buckets in ascending order', () => {
    render(<RatingDistributionChart ratings={MOCK_RATING_STATS} averagePersonalRating={8.2} />);

    expect(screen.getByText('Personal Rating Distribution')).toBeInTheDocument();
    expect(screen.getByText('Total Rated:')).toBeInTheDocument();
    expect(screen.getByText('Unrated Entries:')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument(); // totalRated count

    // Verify screen-reader table has all 19 buckets + 1 unrated row + 1 header = 21 rows
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(21);

    // Row 1 is 1.0, row 19 is 10.0, row 20 is Unrated
    expect(rows[1]).toHaveTextContent('1.0');
    expect(rows[19]).toHaveTextContent('10.0');
    expect(rows[20]).toHaveTextContent('Unrated');
    expect(rows[20]).toHaveTextContent('5');
  });

  it('renders averagePersonalRating marker text when average is provided', () => {
    render(<RatingDistributionChart ratings={MOCK_RATING_STATS} averagePersonalRating={8.2} />);

    expect(screen.getByText('Avg 8.2')).toBeInTheDocument();
  });

  it('omits average marker line when averagePersonalRating is null', () => {
    render(<RatingDistributionChart ratings={MOCK_RATING_STATS} averagePersonalRating={null} />);

    expect(screen.queryByText(/Avg /)).toBeNull();
  });

  it('renders foundation empty state when ratings is null or empty', () => {
    render(<RatingDistributionChart ratings={null} />);

    expect(screen.getByText('Rating Distribution')).toBeInTheDocument();
    expect(screen.getByText(/Analytics not yet connected/i)).toBeInTheDocument();
  });
});
