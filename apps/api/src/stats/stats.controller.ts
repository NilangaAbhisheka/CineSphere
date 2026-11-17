import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ActivityTimelineData,
  GenreStatItem,
  RatingStatsData,
  StatsOverviewSummary,
} from '@cinesphere/shared';
import { StatsService } from './stats.service.js';
import { ActivityQueryDto } from './dto/activity-query.dto.js';

@ApiTags('Stats')
@Controller('stats')
export class StatsController {
  private readonly logger = new Logger(StatsController.name);

  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Viewing summary statistics',
    description:
      'Returns aggregate counts of completed movies, viewing events, watched episodes, completed TV shows, and average personal rating for the user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary viewing statistics retrieved successfully.',
  })
  public async getOverview(): Promise<StatsOverviewSummary> {
    this.logger.log('GET /stats/overview');
    return this.statsService.getOverview();
  }

  @Get('genres')
  @ApiOperation({
    summary: 'Genre distribution of completed titles',
    description:
      'Returns distinct completed title counts and percentage representation across movie and TV genres.',
  })
  @ApiResponse({
    status: 200,
    description: 'Genre distribution retrieved successfully.',
  })
  public async getGenres(): Promise<GenreStatItem[]> {
    this.logger.log('GET /stats/genres');
    return this.statsService.getGenres();
  }

  @Get('activity')
  @ApiOperation({
    summary: 'Monthly viewing activity timeline',
    description:
      'Returns a continuous monthly chronological sequence of movie viewings and episode progress records aggregated in UTC, including zero-activity months.',
  })
  @ApiResponse({
    status: 200,
    description: 'Monthly viewing activity retrieved successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid date range parameters or range exceeds 60 inclusive months.',
  })
  public async getActivity(@Query() query: ActivityQueryDto): Promise<ActivityTimelineData> {
    this.logger.log('GET /stats/activity');
    return this.statsService.getActivity(query);
  }

  @Get('ratings')
  @ApiOperation({
    summary: 'Personal rating distribution',
    description:
      'Returns 19 half-step rating distribution buckets (1.0 to 10.0), total rated titles, and unrated library entries.',
  })
  @ApiResponse({
    status: 200,
    description: 'Personal rating distribution retrieved successfully.',
  })
  public async getRatings(): Promise<RatingStatsData> {
    this.logger.log('GET /stats/ratings');
    return this.statsService.getRatings();
  }
}
