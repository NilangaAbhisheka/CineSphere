import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MediaGenre,
  MovieDetails,
  MovieListItem,
  PaginatedResult,
  TvShowDetails,
  TvShowListItem,
} from '@cinesphere/shared';
import { CatalogueRepository } from '../tmdb/catalogue.repository.js';
import { ListMoviesQueryDto } from './dto/list-movies-query.dto.js';
import { ListTvShowsQueryDto } from './dto/list-tv-shows-query.dto.js';

@Injectable()
export class CatalogueService {
  constructor(private readonly catalogueRepo: CatalogueRepository) {}

  public async listMovies(query: ListMoviesQueryDto): Promise<PaginatedResult<MovieListItem>> {
    if (
      query.minRating !== undefined &&
      query.maxRating !== undefined &&
      query.minRating > query.maxRating
    ) {
      throw new BadRequestException('minRating cannot be greater than maxRating');
    }

    const { items, totalResults, page, limit, totalPages } =
      await this.catalogueRepo.findMovies(query);

    const mappedItems: MovieListItem[] = items.map((m) => ({
      id: m.id,
      tmdbId: m.tmdbId,
      title: m.title,
      originalTitle: m.originalTitle,
      overview: m.overview,
      releaseDate: m.releaseDate ? m.releaseDate.toISOString().split('T')[0] : null,
      runtime: m.runtime,
      originalLanguage: m.originalLanguage,
      popularity: m.popularity,
      voteAverage: m.voteAverage,
      voteCount: m.voteCount,
      posterPath: m.posterPath,
      backdropPath: m.backdropPath,
      genres: m.genres.map((g) => ({
        id: g.tmdbId,
        name: g.name,
      })),
    }));

    return {
      items: mappedItems,
      page,
      limit,
      totalResults,
      totalPages,
    };
  }

  public async getMovieById(id: string): Promise<MovieDetails> {
    const movie = await this.catalogueRepo.findMovieById(id);

    if (!movie) {
      throw new NotFoundException(`Movie with ID "${id}" was not found.`);
    }

    return {
      id: movie.id,
      tmdbId: movie.tmdbId,
      title: movie.title,
      originalTitle: movie.originalTitle,
      overview: movie.overview,
      releaseDate: movie.releaseDate ? movie.releaseDate.toISOString().split('T')[0] : null,
      runtime: movie.runtime,
      originalLanguage: movie.originalLanguage,
      popularity: movie.popularity,
      voteAverage: movie.voteAverage,
      voteCount: movie.voteCount,
      posterPath: movie.posterPath,
      backdropPath: movie.backdropPath,
      adult: movie.adult,
      createdAt: movie.createdAt.toISOString(),
      updatedAt: movie.updatedAt.toISOString(),
      syncedAt: movie.syncedAt ? movie.syncedAt.toISOString() : null,
      genres: movie.genres.map((g) => ({
        id: g.tmdbId,
        name: g.name,
      })),
      keywords: movie.keywords.map((k) => ({
        id: k.tmdbId,
        name: k.name,
      })),
      cast: movie.personCredits.map((c) => ({
        id: c.id,
        personId: c.person.id,
        tmdbId: c.person.tmdbId,
        name: c.person.name,
      })),
    };
  }

  public async listTvShows(query: ListTvShowsQueryDto): Promise<PaginatedResult<TvShowListItem>> {
    if (
      query.minRating !== undefined &&
      query.maxRating !== undefined &&
      query.minRating > query.maxRating
    ) {
      throw new BadRequestException('minRating cannot be greater than maxRating');
    }

    const { items, totalResults, page, limit, totalPages } =
      await this.catalogueRepo.findTvShows(query);

    const mappedItems: TvShowListItem[] = items.map((s) => ({
      id: s.id,
      tmdbId: s.tmdbId,
      name: s.name,
      originalName: s.originalName,
      overview: s.overview,
      firstAirDate: s.firstAirDate ? s.firstAirDate.toISOString().split('T')[0] : null,
      lastAirDate: s.lastAirDate ? s.lastAirDate.toISOString().split('T')[0] : null,
      originalLanguage: s.originalLanguage,
      popularity: s.popularity,
      voteAverage: s.voteAverage,
      voteCount: s.voteCount,
      posterPath: s.posterPath,
      backdropPath: s.backdropPath,
      status: s.status,
      numberOfSeasons: s.numberOfSeasons,
      numberOfEpisodes: s.numberOfEpisodes,
      genres: s.genres.map((g) => ({
        id: g.tmdbId,
        name: g.name,
      })),
    }));

    return {
      items: mappedItems,
      page,
      limit,
      totalResults,
      totalPages,
    };
  }

  public async getTvShowById(id: string): Promise<TvShowDetails> {
    const show = await this.catalogueRepo.findTvShowById(id);

    if (!show) {
      throw new NotFoundException(`TV show with ID "${id}" was not found.`);
    }

    return {
      id: show.id,
      tmdbId: show.tmdbId,
      name: show.name,
      originalName: show.originalName,
      overview: show.overview,
      firstAirDate: show.firstAirDate ? show.firstAirDate.toISOString().split('T')[0] : null,
      lastAirDate: show.lastAirDate ? show.lastAirDate.toISOString().split('T')[0] : null,
      originalLanguage: show.originalLanguage,
      popularity: show.popularity,
      voteAverage: show.voteAverage,
      voteCount: show.voteCount,
      posterPath: show.posterPath,
      backdropPath: show.backdropPath,
      status: show.status,
      numberOfSeasons: show.numberOfSeasons,
      numberOfEpisodes: show.numberOfEpisodes,
      createdAt: show.createdAt.toISOString(),
      updatedAt: show.updatedAt.toISOString(),
      syncedAt: show.syncedAt ? show.syncedAt.toISOString() : null,
      genres: show.genres.map((g) => ({
        id: g.tmdbId,
        name: g.name,
      })),
      keywords: show.keywords.map((k) => ({
        id: k.tmdbId,
        name: k.name,
      })),
      cast: show.personCredits.map((c) => ({
        id: c.id,
        personId: c.person.id,
        tmdbId: c.person.tmdbId,
        name: c.person.name,
      })),
      seasons: show.seasons.map((s) => ({
        id: s.id,
        tmdbId: s.tmdbId,
        seasonNumber: s.seasonNumber,
        name: s.name,
        overview: s.overview,
        posterPath: s.posterPath,
        airDate: s.airDate ? s.airDate.toISOString().split('T')[0] : null,
        episodeCount: s.episodes.length,
        episodes: s.episodes.map((e) => ({
          id: e.id,
          tmdbId: e.tmdbId,
          episodeNumber: e.episodeNumber,
          name: e.name,
          overview: e.overview,
          airDate: e.airDate ? e.airDate.toISOString().split('T')[0] : null,
          runtime: e.runtime,
        })),
      })),
    };
  }

  public async listGenres(): Promise<MediaGenre[]> {
    const genres = await this.catalogueRepo.findGenres();
    return genres.map((g) => ({
      id: g.tmdbId,
      name: g.name,
    }));
  }
}
