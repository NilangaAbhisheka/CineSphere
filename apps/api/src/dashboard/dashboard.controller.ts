import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ContinueWatchingItem,
  DashboardOverviewResponse,
  DashboardStats,
  QuickPickItem,
  RecentActivityItem,
} from '@cinesphere/shared';
import { DashboardService } from './dashboard.service.js';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Dashboard overview',
    description:
      'Returns a consolidated dashboard payload including stats, continue watching, recent activity, and quick picks. Use this as the primary initial load request.',
  })
  public async getOverview(): Promise<DashboardOverviewResponse> {
    this.logger.log('GET /dashboard/overview');
    return this.dashboardService.getOverview();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Viewing statistics',
    description: 'Returns aggregate library and viewing statistics for the user.',
  })
  public async getStats(): Promise<DashboardStats> {
    this.logger.log('GET /dashboard/stats');
    return this.dashboardService.getStats();
  }

  @Get('continue-watching')
  @ApiOperation({
    summary: 'Continue watching',
    description:
      'Returns TV shows in progress (status=WATCHING, not all regular episodes watched), sorted by most recently watched.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max results (default 10)',
  })
  public async getContinueWatching(
    @Query('limit') limit?: string,
  ): Promise<ContinueWatchingItem[]> {
    this.logger.log('GET /dashboard/continue-watching');
    return this.dashboardService.getContinueWatching(this.parseLimit(limit));
  }

  @Get('recent-activity')
  @ApiOperation({
    summary: 'Recent activity',
    description:
      'Returns the most recent movie viewing events and TV episode progress records, merged and sorted by watchedAt descending.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max results (default 10)',
  })
  public async getRecentActivity(@Query('limit') limit?: string): Promise<RecentActivityItem[]> {
    this.logger.log('GET /dashboard/recent-activity');
    return this.dashboardService.getRecentActivity(this.parseLimit(limit));
  }

  @Get('quick-picks')
  @ApiOperation({
    summary: 'Quick picks',
    description:
      'Returns a balanced mix of popular movies and TV shows from the local catalogue, excluding titles already in the user library.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max results (default 10)',
  })
  public async getQuickPicks(@Query('limit') limit?: string): Promise<QuickPickItem[]> {
    this.logger.log('GET /dashboard/quick-picks');
    return this.dashboardService.getQuickPicks(this.parseLimit(limit));
  }

  /**
   * Parses a query-string limit value. Returns 10 if the value is absent or
   * not a finite integer. Clamps the result to [1, 50].
   */
  private parseLimit(raw: string | undefined, defaultLimit = 10): number {
    if (raw === undefined || raw === null) return defaultLimit;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return defaultLimit;
    return Math.min(Math.max(n, 1), 50);
  }
}
