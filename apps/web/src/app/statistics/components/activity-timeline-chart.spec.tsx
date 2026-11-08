import React from 'react';
import { render, screen } from '@testing-library/react';
import { ActivityTimelineChart } from './activity-timeline-chart';
import { MOCK_ACTIVITY_TIMELINE } from '../test-fixtures/stats-fixtures';

describe('ActivityTimelineChart', () => {
  it('renders all months supplied in the timeline', () => {
    render(<ActivityTimelineChart activity={MOCK_ACTIVITY_TIMELINE} />);

    expect(screen.getByText('Viewing Activity Timeline')).toBeInTheDocument();
    // Months: May, Jun, Jul, Aug, Sep, Oct
    expect(screen.getByText('May')).toBeInTheDocument();
    expect(screen.getByText('Jun')).toBeInTheDocument();
    expect(screen.getByText('Jul')).toBeInTheDocument();
    expect(screen.getByText('Aug')).toBeInTheDocument();
    expect(screen.getByText('Sep')).toBeInTheDocument();
    expect(screen.getByText('Oct')).toBeInTheDocument();
  });

  it('preserves and displays zero-activity months without errors', () => {
    render(<ActivityTimelineChart activity={MOCK_ACTIVITY_TIMELINE} />);

    // Jul 2026 has 0 movie viewings and 0 episodes watched in fixture
    expect(screen.getByText('Jul')).toBeInTheDocument();

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveTextContent('Jul 2026');
  });

  it('renders visual legend for Movie Viewings and Episodes Watched', () => {
    render(<ActivityTimelineChart activity={MOCK_ACTIVITY_TIMELINE} />);

    // Movie Viewings appears in legend and table header
    expect(screen.getAllByText('Movie Viewings').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Episodes Watched').length).toBeGreaterThanOrEqual(1);
  });

  it('provides an accessible screen-reader table with exact activity values', () => {
    render(<ActivityTimelineChart activity={MOCK_ACTIVITY_TIMELINE} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toBeInTheDocument();

    // Table rows: 1 header row + 6 month data rows = 7 rows
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(7);

    // Verify row 1 corresponds to May 2026 with correct numbers
    expect(rows[1]).toHaveTextContent('May 2026');
    expect(rows[1]).toHaveTextContent('3');
    expect(rows[1]).toHaveTextContent('24');
    expect(rows[1]).toHaveTextContent('27');
  });

  it('renders foundation empty state when activity is null or empty', () => {
    render(<ActivityTimelineChart activity={null} />);

    expect(screen.getByText('Viewing Activity Timeline')).toBeInTheDocument();
    expect(screen.getByText(/Analytics not yet connected/i)).toBeInTheDocument();
  });
});
