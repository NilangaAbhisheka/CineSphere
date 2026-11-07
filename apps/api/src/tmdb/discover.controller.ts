import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TmdbMovieSearchResult, TmdbSearchResponse, TmdbTvSearchResult } from '@cinesphere/shared';
import { TmdbService } from './tmdb.service.js';
import {
  TmdbMovieSearchQueryDto,
  TmdbPaginationQueryDto,
  TmdbTvSearchQueryDto,
} from './dto/discover-tmdb.dto.js';

@ApiTags('TMDB Discovery')
@Controller('discover/tmdb')
export class DiscoverController {
  constructor(private readonly tmdbService: TmdbService) {}

  @Get('movies')
  @ApiOperation({
    summary: 'Search movies remotely on TMDB',
    description:
      'Queries the TMDB /search/movie endpoint and returns paginated search results without persisting them to PostgreSQL.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated movie search results from TMDB.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid search parameters.',
  })
  public async searchMovies(
    @Query() queryDto: TmdbMovieSearchQueryDto,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    return this.tmdbService.searchMovies(
      queryDto.query,
      queryDto.page,
      queryDto.includeAdult,
      queryDto.year,
      queryDto.primaryReleaseYear,
    );
  }

  @Get('tv')
  @ApiOperation({
    summary: 'Search TV shows remotely on TMDB',
    description:
      'Queries the TMDB /search/tv endpoint and returns paginated search results without persisting them to PostgreSQL.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated TV show search results from TMDB.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid search parameters.',
  })
  public async searchTvShows(
    @Query() queryDto: TmdbTvSearchQueryDto,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    return this.tmdbService.searchTvShows(
      queryDto.query,
      queryDto.page,
      queryDto.includeAdult,
      queryDto.firstAirDateYear,
    );
  }

  @Get('trending/movies')
  @ApiOperation({
    summary: 'Get trending movies on TMDB',
    description: 'Fetches today trending movies from TMDB with pagination.',
  })
  @ApiResponse({ status: 200, description: 'Paginated trending movies.' })
  public async getTrendingMovies(
    @Query() query: TmdbPaginationQueryDto,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    return this.tmdbService.getTrendingMovies('day', query.page);
  }

  @Get('trending/tv')
  @ApiOperation({
    summary: 'Get trending TV shows on TMDB',
    description: 'Fetches today trending TV shows from TMDB with pagination.',
  })
  @ApiResponse({ status: 200, description: 'Paginated trending TV shows.' })
  public async getTrendingTvShows(
    @Query() query: TmdbPaginationQueryDto,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    return this.tmdbService.getTrendingTvShows('day', query.page);
  }

  @Get('popular/movies')
  @ApiOperation({
    summary: 'Get popular movies on TMDB',
    description: 'Fetches current popular movies from TMDB with pagination.',
  })
  @ApiResponse({ status: 200, description: 'Paginated popular movies.' })
  public async getPopularMovies(
    @Query() query: TmdbPaginationQueryDto,
  ): Promise<TmdbSearchResponse<TmdbMovieSearchResult>> {
    return this.tmdbService.getPopularMovies(query.page);
  }

  @Get('popular/tv')
  @ApiOperation({
    summary: 'Get popular TV shows on TMDB',
    description: 'Fetches current popular TV shows from TMDB with pagination.',
  })
  @ApiResponse({ status: 200, description: 'Paginated popular TV shows.' })
  public async getPopularTvShows(
    @Query() query: TmdbPaginationQueryDto,
  ): Promise<TmdbSearchResponse<TmdbTvSearchResult>> {
    return this.tmdbService.getPopularTvShows(query.page);
  }
}
