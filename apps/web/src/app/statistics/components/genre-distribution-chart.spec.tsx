import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GenreDistributionChart } from './genre-distribution-chart';
import { MOCK_GENRE_STATS } from '../test-fixtures/stats-fixtures';

describe('GenreDistributionChart', () => {
  it('renders top 8 genres by default in descending order of completedTitleCount', () => {
    render(<GenreDistributionChart genres={MOCK_GENRE_STATS} />);

    // Top genre should be Science Fiction (12) - appears in visual bar and sr-table
    expect(screen.getAllByText('Science Fiction').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/12/).length).toBeGreaterThanOrEqual(1);

    // 8th genre is Fantasy (3)
    expect(screen.getAllByText('Fantasy').length).toBeGreaterThanOrEqual(1);

    // 9th genre is Horror and 10th is Animation; in visual bars they should NOT be visible by default (only in the sr-only table for full accessibility)
    const viewAllBtn = screen.getByRole('button', { name: /view all \(10\)/i });
    expect(viewAllBtn).toBeInTheDocument();
  });

  it('provides a "View all" toggle when more than 8 genres exist and expands to show all', () => {
    render(<GenreDistributionChart genres={MOCK_GENRE_STATS} />);

    const viewAllBtn = screen.getByRole('button', { name: /view all \(10\)/i });
    expect(viewAllBtn).toBeInTheDocument();

    // Click to expand
    fireEvent.click(viewAllBtn);

    // Now 9th and 10th genres should be visible in visual bars and sr-table (at least 2 occurrences each)
    expect(screen.getAllByText('Horror').length).toBe(2); // 1 visual bar + 1 table row
    expect(screen.getAllByText('Animation').length).toBe(2); // 1 visual bar + 1 table row
    expect(screen.getByRole('button', { name: /show top 8/i })).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(screen.getByRole('button', { name: /show top 8/i }));
    // When collapsed, Horror is only in the sr-only table (1 occurrence)
    expect(screen.getAllByText('Horror').length).toBe(1);
  });

  it('sorts alphabetically when title counts are tied', () => {
    const tiedGenres = [
      { genreId: 1, name: 'Western', completedTitleCount: 5, percentage: 25 },
      { genreId: 2, name: 'Action', completedTitleCount: 5, percentage: 25 },
      { genreId: 3, name: 'Comedy', completedTitleCount: 5, percentage: 25 },
    ];

    render(<GenreDistributionChart genres={tiedGenres} />);

    // Screen reader table rows should be ordered: Action, Comedy, Western
    const rows = screen.getAllByRole('row');
    // Row 0 is header, rows 1-3 are data
    expect(rows[1]).toHaveTextContent('Action');
    expect(rows[2]).toHaveTextContent('Comedy');
    expect(rows[3]).toHaveTextContent('Western');
  });

  it('does not introduce an "Other" category', () => {
    render(<GenreDistributionChart genres={MOCK_GENRE_STATS} />);
    expect(screen.queryByText(/^Other$/i)).toBeNull();
  });

  it('renders accessible data table with caption and headers', () => {
    render(<GenreDistributionChart genres={MOCK_GENRE_STATS} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toBeInTheDocument();
    expect(screen.getByText('Genre distribution of completed titles')).toBeInTheDocument();
  });

  it('renders foundation empty state when genres is null or empty', () => {
    render(<GenreDistributionChart genres={null} />);

    expect(screen.getByText('Genre Breakdown')).toBeInTheDocument();
    expect(screen.getByText(/Analytics not yet connected/i)).toBeInTheDocument();
  });
});
