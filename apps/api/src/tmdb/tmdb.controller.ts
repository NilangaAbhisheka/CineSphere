import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IngestMovieResult, IngestTvShowResult } from '@cinesphere/shared';
import { TmdbService } from './tmdb.service.js';
import { IngestMediaParamDto } from './dto/ingest-media.dto.js';

@ApiTags('TMDB Catalogue Ingestion')
@Controller('catalogue/ingest')
export class TmdbController {
  constructor(private readonly tmdbService: TmdbService) {}

  @Post('movie/:tmdbId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ingest or sync a movie from TMDB',
    description:
      'Fetches movie metadata, credits, keywords, and genres from TMDB and upserts them into the CineSphere catalogue.',
  })
  @ApiParam({
    name: 'tmdbId',
    description: 'TMDB movie integer ID',
    example: 550,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Movie successfully ingested or updated.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Movie not found on TMDB.',
  })
  public async ingestMovie(@Param() params: IngestMediaParamDto): Promise<IngestMovieResult> {
    return this.tmdbService.ingestMovie(params.tmdbId);
  }

  @Post('tv/:tmdbId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ingest or sync a TV show from TMDB',
    description:
      'Fetches TV show metadata, cast credits, genres, keywords, seasons, and episodes from TMDB and upserts them into the CineSphere catalogue.',
  })
  @ApiParam({
    name: 'tmdbId',
    description: 'TMDB TV show integer ID',
    example: 1399,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'TV show and seasons successfully ingested or updated.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'TV show not found on TMDB.',
  })
  public async ingestTvShow(@Param() params: IngestMediaParamDto): Promise<IngestTvShowResult> {
    return this.tmdbService.ingestTvShow(params.tmdbId);
  }
}
