/**
 * page.spec.tsx — Statistics page tests (Phase 3.7 Foundation)
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import StatisticsPage from './page';

describe('StatisticsPage', () => {
  it('renders page header title and subtitle', () => {
    render(<StatisticsPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Statistics' })).toBeInTheDocument();
    expect(
      screen.getByText('Personal viewing analytics and tracking intelligence.'),
    ).toBeInTheDocument();
  });

  it('renders the Phase 3.7 foundation state banner', () => {
    render(<StatisticsPage />);

    expect(screen.getByText('Statistics Foundation (Phase 3.7)')).toBeInTheDocument();
    expect(
      screen.getByText(/As you track movies, log viewing events, and check off TV episodes/i),
    ).toBeInTheDocument();
  });

  it('renders summary cards with authentic unavailable indicators and no fabricated numbers', () => {
    render(<StatisticsPage />);

    // Check all summary card labels are rendered
    expect(screen.getByText('Movies Completed')).toBeInTheDocument();
    expect(screen.getByText('Episodes Watched')).toBeInTheDocument();
    expect(screen.getByText('Shows Completed')).toBeInTheDocument();
    expect(screen.getByText('Average Rating')).toBeInTheDocument();

    // Check placeholder dashes are rendered for all 4 summary values
    const dashes = screen.getAllByText('—');
    // 4 for cards + 1 for movie viewings secondary metric
    expect(dashes.length).toBe(5);

    // Check "(Analytics will connect in Phase 4)" secondary text appears
    expect(screen.getByText('(Analytics will connect in Phase 4)')).toBeInTheDocument();
  });

  it('renders all chart placeholders in foundation state without fabricated charts', () => {
    render(<StatisticsPage />);

    // Section regions are present
    expect(screen.getByRole('region', { name: 'Genre Distribution' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Viewing Activity Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Rating Distribution' })).toBeInTheDocument();

    // Chart placeholders show "Analytics not yet connected" badges
    const placeholders = screen.getAllByText('Analytics not yet connected');
    expect(placeholders.length).toBe(3);
  });
});
