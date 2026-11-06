import { TmdbMapper } from './tmdb.mapper.js';
import {
  TmdbMovieDetailsResponse,
  TmdbSeasonDetailsResponse,
  TmdbTvShowDetailsResponse,
} from './tmdb.types.js';

describe('TmdbMapper', () => {
  describe('Movie mapping', () => {
    it('correctly maps movie details, genres, keywords, and cast', () => {
      const mockResponse: TmdbMovieDetailsResponse = {
        id: 550,
        title: 'Fight Club',
        original_title: 'Fight Club',
        overview: 'An insomniac office worker...',
        release_date: '1999-10-15',
        runtime: 139,
        original_language: 'en',
        popularity: 61.416,
        vote_average: 8.433,
        vote_count: 26280,
        poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
        backdrop_path: '/hZkgoQYus5vegHoetLkCJzb17zJ.jpg',
        adult: false,
        genres: [
          { id: 18, name: 'Drama' },
          { id: 18, name: 'Drama' }, // Duplicate
        ],
        keywords: {
          id: 550,
          keywords: [
            { id: 825, name: 'support group' },
            { id: 825, name: 'support group' }, // Duplicate
          ],
        },
        credits: {
          id: 550,
          cast: [
            { id: 819, name: 'Edward Norton', order: 0 },
            { id: 287, name: 'Brad Pitt', order: 1 },
            { id: 819, name: 'Edward Norton', order: 2 }, // Duplicate
          ],
        },
      };

      const mapped = TmdbMapper.mapMovie(mockResponse);

      expect(mapped.tmdbId).toBe(550);
      expect(mapped.title).toBe('Fight Club');
      expect(mapped.releaseDate).toBeInstanceOf(Date);
      expect(mapped.releaseDate?.toISOString().slice(0, 10)).toBe('1999-10-15');
      expect(mapped.runtime).toBe(139);
      expect(mapped.adult).toBe(false);

      // Deduplication
      expect(mapped.genres).toHaveLength(1);
      expect(mapped.genres[0]).toEqual({ tmdbId: 18, name: 'Drama' });

      expect(mapped.keywords).toHaveLength(1);
      expect(mapped.keywords[0]).toEqual({ tmdbId: 825, name: 'support group' });

      expect(mapped.cast).toHaveLength(2);
      expect(mapped.cast.map((c) => c.tmdbId)).toEqual([819, 287]);
    });

    it('handles nullable and missing fields safely', () => {
      const mockResponse: TmdbMovieDetailsResponse = {
        id: 12345,
        title: 'Minimal Movie',
      };

      const mapped = TmdbMapper.mapMovie(mockResponse);

      expect(mapped.tmdbId).toBe(12345);
      expect(mapped.title).toBe('Minimal Movie');
      expect(mapped.originalTitle).toBeNull();
      expect(mapped.overview).toBeNull();
      expect(mapped.releaseDate).toBeNull();
      expect(mapped.runtime).toBeNull();
      expect(mapped.originalLanguage).toBeNull();
      expect(mapped.popularity).toBeNull();
      expect(mapped.voteAverage).toBeNull();
      expect(mapped.voteCount).toBeNull();
      expect(mapped.posterPath).toBeNull();
      expect(mapped.backdropPath).toBeNull();
      expect(mapped.adult).toBe(false);
      expect(mapped.genres).toEqual([]);
      expect(mapped.keywords).toEqual([]);
      expect(mapped.cast).toEqual([]);
    });
  });

  describe('TV Show and Season mapping', () => {
    it('correctly maps TV show details, keyword results structure, and cast', () => {
      const mockTvResponse: TmdbTvShowDetailsResponse = {
        id: 1399,
        name: 'Game of Thrones',
        original_name: 'Game of Thrones',
        overview: 'Seven noble families fight for control...',
        first_air_date: '2011-04-17',
        last_air_date: '2019-05-19',
        original_language: 'en',
        popularity: 369.594,
        vote_average: 8.455,
        vote_count: 22000,
        poster_path: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
        backdrop_path: '/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg',
        status: 'Ended',
        number_of_seasons: 8,
        number_of_episodes: 73,
        genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }],
        keywords: {
          id: 1399,
          results: [{ id: 818, name: 'based on novel or book' }],
        },
        credits: {
          id: 1399,
          cast: [{ id: 239019, name: 'Emilia Clarke' }],
        },
        seasons: [{ id: 3624, season_number: 1, name: 'Season 1', episode_count: 10 }],
      };

      const mapped = TmdbMapper.mapTvShow(mockTvResponse);

      expect(mapped.tmdbId).toBe(1399);
      expect(mapped.name).toBe('Game of Thrones');
      expect(mapped.numberOfSeasons).toBe(8);
      expect(mapped.numberOfEpisodes).toBe(73);
      expect(mapped.genres).toHaveLength(1);
      expect(mapped.keywords).toHaveLength(1);
      expect(mapped.keywords[0]).toEqual({ tmdbId: 818, name: 'based on novel or book' });
      expect(mapped.cast).toHaveLength(1);
      expect(mapped.seasons).toHaveLength(1);
      expect(mapped.seasons[0]).toEqual({ seasonNumber: 1, tmdbId: 3624 });
    });

    it('correctly maps season and episodes with season 0 / special episodes', () => {
      const mockSeasonResponse: TmdbSeasonDetailsResponse = {
        id: 3623,
        season_number: 0,
        name: 'Specials',
        overview: 'Special features...',
        air_date: '2011-04-10',
        episodes: [
          {
            id: 999991,
            episode_number: 1,
            name: 'Inside Game of Thrones',
            air_date: '2011-04-10',
            runtime: 11,
          },
        ],
      };

      const mapped = TmdbMapper.mapSeason(mockSeasonResponse);

      expect(mapped.seasonNumber).toBe(0);
      expect(mapped.name).toBe('Specials');
      expect(mapped.episodes).toHaveLength(1);
      expect(mapped.episodes[0].episodeNumber).toBe(1);
      expect(mapped.episodes[0].tmdbId).toBe(999991);
      expect(mapped.episodes[0].runtime).toBe(11);
    });
  });
});
