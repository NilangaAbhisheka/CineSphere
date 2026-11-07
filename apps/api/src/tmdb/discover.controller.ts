import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TmdbMovieSearchResult, TmdbSearchResponse, TmdbTvSearchResult } from '@cinesphere/shared';
import { TmdbService } from './tmdb.service.js';
import { TmdbMovieSearchQueryDto, TmdbTvSearchQueryDto } from './dto/discover-tmdb.dto.js';

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
}
