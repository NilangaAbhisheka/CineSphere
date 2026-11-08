/**
 * stats-fixtures.ts — Realistic test fixtures for Statistics components and specs.
 *
 * NOTE: Strictly isolated for testing. Never import this file into production route code.
 */

import {
  ActivityTimelineData,
  GenreStatItem,
  RatingStatsData,
  StatisticsPageData,
  StatsOverviewSummary,
} from '@cinesphere/shared';

export const MOCK_STATS_SUMMARY: StatsOverviewSummary = {
  moviesCompleted: 14,
  movieViewingEvents: 19, // Notice: 19 viewings across 14 completed movies (repeat viewings exist)
  episodesWatched: 182,
  tvShowsCompleted: 6,
  averagePersonalRating: 8.2,
};

export const MOCK_GENRE_STATS: GenreStatItem[] = [
  { genreId: 878, name: 'Science Fiction', completedTitleCount: 12, percentage: 60 },
  { genreId: 28, name: 'Action', completedTitleCount: 10, percentage: 50 },
  { genreId: 18, name: 'Drama', completedTitleCount: 9, percentage: 45 },
  { genreId: 53, name: 'Thriller', completedTitleCount: 7, percentage: 35 },
  { genreId: 12, name: 'Adventure', completedTitleCount: 6, percentage: 30 },
  { genreId: 35, name: 'Comedy', completedTitleCount: 5, percentage: 25 },
  { genreId: 9648, name: 'Mystery', completedTitleCount: 4, percentage: 20 },
  { genreId: 14, name: 'Fantasy', completedTitleCount: 3, percentage: 15 },
  { genreId: 27, name: 'Horror', completedTitleCount: 2, percentage: 10 },
  { genreId: 16, name: 'Animation', completedTitleCount: 2, percentage: 10 },
];

export const MOCK_ACTIVITY_TIMELINE: ActivityTimelineData = {
  from: '2026-05',
  to: '2026-10',
  items: [
    {
      period: '2026-05',
      label: 'May 2026',
      movieViewings: 3,
      episodesWatched: 24,
      totalActivity: 27,
    },
    {
      period: '2026-06',
      label: 'Jun 2026',
      movieViewings: 1,
      episodesWatched: 40,
      totalActivity: 41,
    },
    {
      period: '2026-07',
      label: 'Jul 2026',
      movieViewings: 0,
      episodesWatched: 0,
      totalActivity: 0,
    }, // Zero activity month preserved
    {
      period: '2026-08',
      label: 'Aug 2026',
      movieViewings: 5,
      episodesWatched: 32,
      totalActivity: 37,
    },
    {
      period: '2026-09',
      label: 'Sep 2026',
      movieViewings: 6,
      episodesWatched: 45,
      totalActivity: 51,
    },
    {
      period: '2026-10',
      label: 'Oct 2026',
      movieViewings: 4,
      episodesWatched: 41,
      totalActivity: 45,
    },
  ],
};

export const MOCK_RATING_STATS: RatingStatsData = {
  buckets: [
    { rating: 1.0, count: 0 },
    { rating: 1.5, count: 0 },
    { rating: 2.0, count: 0 },
    { rating: 2.5, count: 0 },
    { rating: 3.0, count: 0 },
    { rating: 3.5, count: 0 },
    { rating: 4.0, count: 0 },
    { rating: 4.5, count: 0 },
    { rating: 5.0, count: 1 },
    { rating: 5.5, count: 0 },
    { rating: 6.0, count: 1 },
    { rating: 6.5, count: 2 },
    { rating: 7.0, count: 3 },
    { rating: 7.5, count: 2 },
    { rating: 8.0, count: 5 },
    { rating: 8.5, count: 4 },
    { rating: 9.0, count: 3 },
    { rating: 9.5, count: 1 },
    { rating: 10.0, count: 1 },
  ],
  unratedLibraryEntries: 5,
  totalRated: 23,
};

export const MOCK_STATISTICS_PAGE_DATA: StatisticsPageData = {
  summary: MOCK_STATS_SUMMARY,
  genres: MOCK_GENRE_STATS,
  activity: MOCK_ACTIVITY_TIMELINE,
  ratings: MOCK_RATING_STATS,
};
