import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  EpisodeProgressResponse,
  LibraryEntryListItem,
  LibraryEntryResponse,
  MarkAllWatchedResponse,
  PaginatedResult,
  SeasonRatingResponse,
  ViewingEventResponse,
} from '@cinesphere/shared';
import { LibraryService } from './library.service.js';
import { CreateLibraryEntryDto } from './dto/create-library-entry.dto.js';
import { UpdateLibraryEntryDto } from './dto/update-library-entry.dto.js';
import { ListLibraryQueryDto } from './dto/list-library-query.dto.js';
import { CreateViewingEventDto } from './dto/create-viewing-event.dto.js';
import { CreateEpisodeProgressDto } from './dto/create-episode-progress.dto.js';
import { MarkAllWatchedDto } from './dto/mark-all-watched.dto.js';
import { CreateSeasonRatingDto } from './dto/create-season-rating.dto.js';
import { UpdateSeasonRatingDto } from './dto/update-season-rating.dto.js';

@ApiTags('Personal Library & Tracking')
@Controller('library')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add title to personal library',
    description:
      'Creates a new UserLibraryEntry for the authenticated single user. Resolves TMDB IDs on-demand if not already in local catalogue.',
  })
  @ApiResponse({ status: 201, description: 'Library entry created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation failed or media identifier missing.' })
  @ApiConflictResponse({ description: 'This title is already present in your library.' })
  public async createLibraryEntry(
    @Body() dto: CreateLibraryEntryDto,
  ): Promise<LibraryEntryResponse> {
    return this.libraryService.createLibraryEntry(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List and filter personal library entries',
    description:
      'Returns a paginated list of library entries scoped to the single user, with optional filtering by status and media type.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of library entries.' })
  public async listLibrary(
    @Query() query: ListLibraryQueryDto,
  ): Promise<PaginatedResult<LibraryEntryListItem>> {
    return this.libraryService.listLibrary(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get library entry details by UUID',
    description:
      'Returns complete library entry metadata, including viewing events history, episode progress, and season ratings.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiResponse({ status: 200, description: 'Detailed library entry.' })
  @ApiResponse({ status: 404, description: 'Library entry not found.' })
  public async getLibraryEntry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<LibraryEntryResponse> {
    return this.libraryService.getLibraryEntry(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update library entry status, rating, or notes',
    description: 'Updates tracking status, personal rating (half-step 1.0-10.0), and personal notes.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiResponse({ status: 200, description: 'Updated library entry.' })
  @ApiResponse({ status: 400, description: 'Invalid rating or status value.' })
  @ApiResponse({ status: 404, description: 'Library entry not found.' })
  public async updateLibraryEntry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateLibraryEntryDto,
  ): Promise<LibraryEntryResponse> {
    return this.libraryService.updateLibraryEntry(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove title from personal library',
    description:
      'Deletes the UserLibraryEntry and automatically cascade deletes all viewing events, episode progress, and season ratings.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiResponse({ status: 204, description: 'Library entry successfully removed.' })
  @ApiResponse({ status: 404, description: 'Library entry not found.' })
  public async deleteLibraryEntry(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    await this.libraryService.deleteLibraryEntry(id);
  }

  // ── Viewing Event Endpoints ───────────────────────────────────────────────────

  @Post(':id/viewing-events')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record an append-only viewing event (watch/rewatch)',
    description:
      'Records a viewing occurrence with optional timestamp, session rating, and viewing notes. Does not alter library status.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiResponse({ status: 201, description: 'Viewing event recorded.' })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 404, description: 'Library entry not found.' })
  public async createViewingEvent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateViewingEventDto,
  ): Promise<ViewingEventResponse> {
    return this.libraryService.createViewingEvent(id, dto);
  }

  // ── Episode Progress Endpoints ────────────────────────────────────────────────

  @Post(':id/episode-progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a TV episode as watched (idempotent)',
    description:
      'Records episode progress for a TV show library entry. Enforces database ownership trigger; idempotent on repeat requests.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiResponse({ status: 200, description: 'Episode progress recorded or already present.' })
  @ApiResponse({ status: 400, description: 'Not a TV show or episode does not belong to show.' })
  @ApiResponse({ status: 404, description: 'Library entry or episode not found.' })
  public async createEpisodeProgress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateEpisodeProgressDto,
  ): Promise<EpisodeProgressResponse> {
    return this.libraryService.createEpisodeProgress(id, dto);
  }

  @Delete(':id/episode-progress/:episodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark a TV episode as unwatched',
    description: 'Removes the episode progress record for the specified episode.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiParam({ name: 'episodeId', description: 'Episode UUID (v4)' })
  @ApiResponse({ status: 204, description: 'Episode progress removed.' })
  @ApiResponse({ status: 400, description: 'Not a TV show.' })
  @ApiResponse({ status: 404, description: 'Library entry not found.' })
  public async deleteEpisodeProgress(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('episodeId', new ParseUUIDPipe({ version: '4' })) episodeId: string,
  ): Promise<void> {
    await this.libraryService.deleteEpisodeProgress(id, episodeId);
  }

  @Post(':id/mark-all-watched')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all episodes of a TV show as watched atomically',
    description:
      'Atomically inserts episode progress records for all episodes belonging to the TV show, with optional special seasons exclusion.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiResponse({ status: 200, description: 'Batch update complete with count of newly added episodes.' })
  @ApiResponse({ status: 400, description: 'Not a TV show.' })
  @ApiResponse({ status: 404, description: 'Library entry not found.' })
  public async markAllWatched(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: MarkAllWatchedDto,
  ): Promise<MarkAllWatchedResponse> {
    return this.libraryService.markAllWatched(id, dto);
  }

  // ── Season Rating Endpoints ───────────────────────────────────────────────────

  @Post(':id/season-ratings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Rate a season of a TV show',
    description:
      'Creates a season-level rating (1.00-10.00 half-step). Enforces season ownership trigger; returns conflict if already rated.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiResponse({ status: 201, description: 'Season rating created.' })
  @ApiResponse({ status: 400, description: 'Validation failed or season does not belong to show.' })
  @ApiConflictResponse({ description: 'Season rating already exists for this season.' })
  @ApiResponse({ status: 404, description: 'Library entry or season not found.' })
  public async createSeasonRating(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateSeasonRatingDto,
  ): Promise<SeasonRatingResponse> {
    return this.libraryService.createSeasonRating(id, dto);
  }

  @Patch(':id/season-ratings/:seasonId')
  @ApiOperation({
    summary: 'Update an existing season rating',
    description: 'Updates the rating for a previously rated season.',
  })
  @ApiParam({ name: 'id', description: 'Internal library entry UUID (v4)' })
  @ApiParam({ name: 'seasonId', description: 'Season UUID (v4)' })
  @ApiResponse({ status: 200, description: 'Season rating updated.' })
  @ApiResponse({ status: 400, description: 'Invalid rating value or not a TV show.' })
  @ApiResponse({ status: 404, description: 'Season rating not found.' })
  public async updateSeasonRating(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('seasonId', new ParseUUIDPipe({ version: '4' })) seasonId: string,
    @Body() dto: UpdateSeasonRatingDto,
  ): Promise<SeasonRatingResponse> {
    return this.libraryService.updateSeasonRating(id, seasonId, dto);
  }
}
