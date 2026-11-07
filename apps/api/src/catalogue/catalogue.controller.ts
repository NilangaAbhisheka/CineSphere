import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  MediaGenre,
  MovieDetails,
  MovieListItem,
  PaginatedResult,
  TvShowDetails,
  TvShowListItem,
} from '@cinesphere/shared';
import { CatalogueService } from './catalogue.service.js';
import { ListMoviesQueryDto } from './dto/list-movies-query.dto.js';
import { ListTvShowsQueryDto } from './dto/list-tv-shows-query.dto.js';

@ApiTags('Local Catalogue')
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogueService: CatalogueService) {}

  @Get('movies')
  @ApiOperation({
    summary: 'Browse and filter movies in local catalogue',
    description:
      'Queries the PostgreSQL movie catalogue with filtering by title query, genre, year, rating, and language, with stable secondary sorting and pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of movie items.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
  })
  public async listMovies(
    @Query() query: ListMoviesQueryDto,
  ): Promise<PaginatedResult<MovieListItem>> {
    return this.catalogueService.listMovies(query);
  }

  @Get('movies/:id')
  @ApiOperation({
    summary: 'Get movie details by internal UUID',
    description:
      'Returns complete stored movie metadata including genres, keywords, and associated cast members.',
  })
  @ApiParam({
    name: 'id',
    description: 'Internal movie UUID (version 4)',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed movie metadata.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid UUID format.',
  })
  @ApiResponse({
    status: 404,
    description: 'Movie not found.',
  })
  public async getMovieById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<MovieDetails> {
    return this.catalogueService.getMovieById(id);
  }

  @Get('tv')
  @ApiOperation({
    summary: 'Browse and filter TV shows in local catalogue',
    description:
      'Queries the PostgreSQL TV show catalogue with filtering by name query, genre, first air year, rating, language, and status, with stable secondary sorting and pagination.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of TV show items.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters.',
  })
  public async listTvShows(
    @Query() query: ListTvShowsQueryDto,
  ): Promise<PaginatedResult<TvShowListItem>> {
    return this.catalogueService.listTvShows(query);
  }

  @Get('tv/:id')
  @ApiOperation({
    summary: 'Get TV show details by internal UUID',
    description:
      'Returns complete stored TV show metadata including genres, keywords, associated cast members, and hierarchical seasons and episodes.',
  })
  @ApiParam({
    name: 'id',
    description: 'Internal TV show UUID (version 4)',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed TV show metadata with seasons and episodes.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid UUID format.',
  })
  @ApiResponse({
    status: 404,
    description: 'TV show not found.',
  })
  public async getTvShowById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<TvShowDetails> {
    return this.catalogueService.getTvShowById(id);
  }

  @Get('genres')
  @ApiOperation({
    summary: 'List all available genres in local catalogue',
    description: 'Returns all distinct genres stored in the CineSphere catalogue.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of genres.',
  })
  public async listGenres(): Promise<MediaGenre[]> {
    return this.catalogueService.listGenres();
  }
}
