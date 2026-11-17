import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ActivityTimelineData,
  ActivityTimelineItem,
  GenreStatItem,
  RatingDistributionBucket,
  RatingStatsData,
  StatsOverviewSummary,
} from '@cinesphere/shared';
import { PrismaService } from '../database/prisma.service.js';
import { SingleUserBootstrap } from '../database/single-user-bootstrap.js';
import { CLOCK_TOKEN, IClock, SystemClock } from './clock.interface.js';
import { ActivityQueryDto } from './dto/activity-query.dto.js';

interface MonthlyCountRow {
  period: string;
  count: number;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const BUCKET_RATINGS = [
  1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0,
];

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userBootstrap: SingleUserBootstrap,
    @Optional() @Inject(CLOCK_TOKEN) private readonly clock: IClock = new SystemClock(),
  ) {}

  /**
   * Returns summary viewing statistics for the current user.
   */
  public async getOverview(): Promise<StatsOverviewSummary> {
    const userId = this.userBootstrap.getUserId();

    const [moviesCompleted, movieViewingEvents, episodesWatched, tvShowsCompleted, ratingAgg] =
      await Promise.all([
        this.prisma.userLibraryEntry.count({
          where: { userId, mediaType: 'MOVIE', status: 'COMPLETED' },
        }),
        this.prisma.viewingEvent.count({
          where: { libraryEntry: { userId, mediaType: 'MOVIE' } },
        }),
        this.prisma.episodeProgress.count({
          where: { libraryEntry: { userId, mediaType: 'TV' } },
        }),
        this.prisma.userLibraryEntry.count({
          where: { userId, mediaType: 'TV', status: 'COMPLETED' },
        }),
        this.prisma.userLibraryEntry.aggregate({
          where: { userId, personalRating: { not: null } },
          _avg: { personalRating: true },
          _count: { personalRating: true },
        }),
      ]);

    const averagePersonalRating =
      ratingAgg._count.personalRating > 0 && ratingAgg._avg.personalRating !== null
        ? Math.round(Number(ratingAgg._avg.personalRating) * 10) / 10
        : null;

    return {
      moviesCompleted,
      movieViewingEvents,
      episodesWatched,
      tvShowsCompleted,
      averagePersonalRating,
    };
  }

  /**
   * Returns genre distribution for completed titles across movies and TV shows.
   */
  public async getGenres(): Promise<GenreStatItem[]> {
    const userId = this.userBootstrap.getUserId();

    const completedEntries = await this.prisma.userLibraryEntry.findMany({
      where: { userId, status: 'COMPLETED' },
      select: {
        id: true,
        mediaType: true,
        movie: {
          select: {
            genres: { select: { tmdbId: true, name: true } },
          },
        },
        tvShow: {
          select: {
            genres: { select: { tmdbId: true, name: true } },
          },
        },
      },
    });

    const totalCompletedTitles = completedEntries.length;
    if (totalCompletedTitles === 0) {
      return [];
    }

    const genreMap = new Map<number, { genreId: number; name: string; count: number }>();

    for (const entry of completedEntries) {
      const genres = entry.mediaType === 'MOVIE' ? entry.movie?.genres : entry.tvShow?.genres;
      // Note: entries without genres still contribute to totalCompletedTitles (denominator),
      // preserving exact percentage semantics across all completed titles.
      if (!genres || genres.length === 0) {
        continue;
      }

      const seenInTitle = new Set<number>();
      for (const g of genres) {
        if (seenInTitle.has(g.tmdbId)) {
          continue;
        }
        seenInTitle.add(g.tmdbId);

        const existing = genreMap.get(g.tmdbId);
        if (existing) {
          existing.count += 1;
        } else {
          genreMap.set(g.tmdbId, { genreId: g.tmdbId, name: g.name, count: 1 });
        }
      }
    }

    return Array.from(genreMap.values())
      .map((item) => ({
        genreId: item.genreId,
        name: item.name,
        completedTitleCount: item.count,
        percentage: Math.round((item.count / totalCompletedTitles) * 100),
      }))
      .sort((a, b) => {
        if (b.completedTitleCount !== a.completedTitleCount) {
          return b.completedTitleCount - a.completedTitleCount;
        }
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Returns monthly viewing activity timeline aggregated in PostgreSQL by UTC month.
   */
  public async getActivity(query: ActivityQueryDto): Promise<ActivityTimelineData> {
    const userId = this.userBootstrap.getUserId();
    const nowUtc = this.clock.now();
    const currentPeriod = nowUtc.toISOString().slice(0, 7);

    let resolvedFrom = query.from;
    let resolvedTo = query.to;

    // Resolve date-range defaults
    if (!resolvedFrom && !resolvedTo) {
      resolvedTo = currentPeriod;
      resolvedFrom = this.subtractMonths(currentPeriod, 11);
    } else if (resolvedFrom && !resolvedTo) {
      resolvedTo = currentPeriod;
    } else if (!resolvedFrom && resolvedTo) {
      resolvedFrom = this.subtractMonths(resolvedTo, 11);
    }

    // Validate resolved range
    if (resolvedFrom! > resolvedTo!) {
      throw new BadRequestException('"from" month cannot be after "to" month');
    }

    const inclusiveMonths = this.countInclusiveMonths(resolvedFrom!, resolvedTo!);
    if (inclusiveMonths > 60) {
      throw new BadRequestException(
        `Requested range cannot exceed 60 inclusive calendar months (requested: ${inclusiveMonths})`,
      );
    }

    const [fromY, fromM] = resolvedFrom!.split('-').map(Number);
    const [toY, toM] = resolvedTo!.split('-').map(Number);

    // Convert to UTC Date boundaries for query
    const startDate = new Date(Date.UTC(fromY, fromM - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(toY, toM, 1, 0, 0, 0, 0));

    // Aggregate monthly counts directly in PostgreSQL using parameterized raw SQL
    const [movieRows, episodeRows] = await Promise.all([
      this.prisma.$queryRaw<MonthlyCountRow[]>`
        SELECT
          TO_CHAR(ve.watched_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
          COUNT(*)::int AS count
        FROM viewing_events ve
        JOIN user_library_entries ule ON ule.id = ve.library_entry_id
        WHERE ule.user_id = ${userId}::uuid
          AND ule.media_type = 'MOVIE'
          AND ve.watched_at >= ${startDate}
          AND ve.watched_at < ${endDate}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      this.prisma.$queryRaw<MonthlyCountRow[]>`
        SELECT
          TO_CHAR(ep.watched_at AT TIME ZONE 'UTC', 'YYYY-MM') AS period,
          COUNT(*)::int AS count
        FROM episode_progress ep
        JOIN user_library_entries ule ON ule.id = ep.library_entry_id
        WHERE ule.user_id = ${userId}::uuid
          AND ule.media_type = 'TV'
          AND ep.watched_at >= ${startDate}
          AND ep.watched_at < ${endDate}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ]);

    const movieMap = new Map<string, number>(movieRows.map((r) => [r.period, r.count]));
    const episodeMap = new Map<string, number>(episodeRows.map((r) => [r.period, r.count]));

    const monthSequence = this.generateMonthSequence(resolvedFrom!, resolvedTo!);

    const items: ActivityTimelineItem[] = monthSequence.map((period) => {
      const movieViewings = movieMap.get(period) ?? 0;
      const episodesWatched = episodeMap.get(period) ?? 0;
      return {
        period,
        label: this.formatMonthLabel(period),
        movieViewings,
        episodesWatched,
        totalActivity: movieViewings + episodesWatched,
      };
    });

    return {
      from: resolvedFrom!,
      to: resolvedTo!,
      items,
    };
  }

  /**
   * Returns personal rating distribution across 19 half-step buckets (1.0 to 10.0).
   */
  public async getRatings(): Promise<RatingStatsData> {
    const userId = this.userBootstrap.getUserId();

    const [ratingGroups, unratedCount] = await Promise.all([
      this.prisma.userLibraryEntry.groupBy({
        by: ['personalRating'],
        where: { userId, personalRating: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.userLibraryEntry.count({
        where: { userId, personalRating: null },
      }),
    ]);

    const countMap = new Map<number, number>(BUCKET_RATINGS.map((r) => [r, 0]));

    for (const group of ratingGroups) {
      if (group.personalRating !== null) {
        const r = Number(group.personalRating);
        countMap.set(r, (countMap.get(r) ?? 0) + group._count._all);
      }
    }

    const buckets: RatingDistributionBucket[] = BUCKET_RATINGS.map((rating) => ({
      rating,
      count: countMap.get(rating) ?? 0,
    }));

    const totalRated = buckets.reduce((sum, b) => sum + b.count, 0);

    return {
      buckets,
      unratedLibraryEntries: unratedCount,
      totalRated,
    };
  }

  // ---------------------------------------------------------------------------
  // Date Helpers
  // ---------------------------------------------------------------------------

  private subtractMonths(period: string, count: number): string {
    const [year, month] = period.split('-').map(Number);
    const totalMonths = year * 12 + (month - 1) - count;
    const resYear = Math.floor(totalMonths / 12);
    const resMonth = (totalMonths % 12) + 1;
    return `${resYear}-${String(resMonth).padStart(2, '0')}`;
  }

  private countInclusiveMonths(from: string, to: string): number {
    const [fromY, fromM] = from.split('-').map(Number);
    const [toY, toM] = to.split('-').map(Number);
    return (toY - fromY) * 12 + (toM - fromM) + 1;
  }

  private generateMonthSequence(from: string, to: string): string[] {
    const [fromY, fromM] = from.split('-').map(Number);
    const [toY, toM] = to.split('-').map(Number);
    const months: string[] = [];
    let y = fromY;
    let m = fromM;
    while (y < toY || (y === toY && m <= toM)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return months;
  }

  private formatMonthLabel(period: string): string {
    const [year, month] = period.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }
}
