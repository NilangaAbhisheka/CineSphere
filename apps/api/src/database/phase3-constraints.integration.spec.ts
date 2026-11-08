/**
 * phase3-constraints.integration.spec.ts
 *
 * Phase 3 — Personal Library Database Integrity & Constraint Integration Tests.
 * Tests live PostgreSQL CHECK constraints, partial unique indexes,
 * triggers, and foreign-key delete behaviors.
 */

import { PrismaClient, Prisma, MediaType, LibraryStatus } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

let _counter = 800_000_000 + Math.floor(Math.random() * 50_000_000);
function uniqueTmdbId(): number {
  return ++_counter;
}

async function createTestUser(): Promise<{ id: string }> {
  return prisma.user.create({
    data: {
      displayName: `Test User ${uniqueTmdbId()}`,
    },
  });
}

async function createTestMovie(): Promise<{ id: string }> {
  return prisma.movie.create({
    data: {
      tmdbId: uniqueTmdbId(),
      title: `Test Movie ${uniqueTmdbId()}`,
    },
  });
}

async function createTestTvHierarchy(): Promise<{
  tvShowId: string;
  seasonId: string;
  episodeId: string;
}> {
  const show = await prisma.tvShow.create({
    data: {
      tmdbId: uniqueTmdbId(),
      name: `Test Show ${uniqueTmdbId()}`,
    },
  });

  const season = await prisma.season.create({
    data: {
      tmdbId: uniqueTmdbId(),
      seasonNumber: 1,
      name: 'Season 1',
      tvShowId: show.id,
    },
  });

  const episode = await prisma.episode.create({
    data: {
      tmdbId: uniqueTmdbId(),
      episodeNumber: 1,
      name: 'Episode 1',
      seasonId: season.id,
    },
  });

  return { tvShowId: show.id, seasonId: season.id, episodeId: episode.id };
}

describe('Phase 3 — Database Integrity & Constraints', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Rating Range & Half-Step CHECK Constraints
  // ────────────────────────────────────────────────────────────────────────────
  describe('Rating CHECK Constraints (DECIMAL(4,2))', () => {
    let user: { id: string };
    let movie: { id: string };
    let tvHierarchy: { tvShowId: string; seasonId: string; episodeId: string };

    beforeEach(async () => {
      user = await createTestUser();
      movie = await createTestMovie();
      tvHierarchy = await createTestTvHierarchy();
    });

    it.each(['1.00', '1.50', '7.00', '7.50', '10.00'])(
      'accepts valid half-step rating %s on UserLibraryEntry',
      async (ratingStr) => {
        const entry = await prisma.userLibraryEntry.create({
          data: {
            userId: user.id,
            mediaType: MediaType.MOVIE,
            movieId: movie.id,
            status: LibraryStatus.PLAN_TO_WATCH,
            personalRating: new Prisma.Decimal(ratingStr),
          },
        });

        expect(entry.personalRating).toBeDefined();
        expect(entry.personalRating?.toFixed(2)).toBe(ratingStr);
      },
    );

    it('allows NULL personal_rating on UserLibraryEntry', async () => {
      const entry = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
          personalRating: null,
        },
      });
      expect(entry.personalRating).toBeNull();
    });

    it.each([
      '0.50', // below minimum 1.00
      '7.24', // invalid half-step
      '7.25', // invalid half-step with decimal precision
      '7.99', // invalid half-step
      '10.50', // above maximum 10.00
      '11.00', // above maximum 10.00
    ])('rejects invalid rating %s on UserLibraryEntry', async (ratingStr) => {
      await expect(
        prisma.userLibraryEntry.create({
          data: {
            userId: user.id,
            mediaType: MediaType.MOVIE,
            movieId: movie.id,
            status: LibraryStatus.PLAN_TO_WATCH,
            personalRating: new Prisma.Decimal(ratingStr),
          },
        }),
      ).rejects.toThrow();
    });

    it('validates ViewingEvent rating range and half-step', async () => {
      const entry = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.COMPLETED,
        },
      });

      // Valid ViewingEvent rating
      const validEvent = await prisma.viewingEvent.create({
        data: {
          libraryEntryId: entry.id,
          rating: new Prisma.Decimal('8.50'),
          notes: 'Great rewatch',
        },
      });
      expect(validEvent.rating?.toFixed(2)).toBe('8.50');

      // NULL rating allowed
      const nullEvent = await prisma.viewingEvent.create({
        data: {
          libraryEntryId: entry.id,
          rating: null,
        },
      });
      expect(nullEvent.rating).toBeNull();

      // Invalid rating rejected
      await expect(
        prisma.viewingEvent.create({
          data: {
            libraryEntryId: entry.id,
            rating: new Prisma.Decimal('7.25'),
          },
        }),
      ).rejects.toThrow();
    });

    it('validates SeasonRating non-null rating range and half-step', async () => {
      const entry = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tvHierarchy.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      // Valid rating
      const validRating = await prisma.seasonRating.create({
        data: {
          libraryEntryId: entry.id,
          seasonId: tvHierarchy.seasonId,
          rating: new Prisma.Decimal('9.00'),
        },
      });
      expect(validRating.rating.toFixed(2)).toBe('9.00');

      // Invalid rating rejected
      await expect(
        prisma.seasonRating.create({
          data: {
            libraryEntryId: entry.id,
            seasonId: tvHierarchy.seasonId,
            rating: new Prisma.Decimal('0.50'),
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Media Type XOR CHECK Constraint
  // ────────────────────────────────────────────────────────────────────────────
  describe('Media-Type Invariant CHECK Constraint', () => {
    let user: { id: string };
    let movie: { id: string };
    let tvHierarchy: { tvShowId: string; seasonId: string; episodeId: string };

    beforeEach(async () => {
      user = await createTestUser();
      movie = await createTestMovie();
      tvHierarchy = await createTestTvHierarchy();
    });

    it('allows valid MOVIE entry with movie_id set and tv_show_id null', async () => {
      const entry = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });
      expect(entry.id).toBeDefined();
      expect(entry.movieId).toBe(movie.id);
      expect(entry.tvShowId).toBeNull();
    });

    it('allows valid TV entry with tv_show_id set and movie_id null', async () => {
      const entry = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tvHierarchy.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });
      expect(entry.id).toBeDefined();
      expect(entry.tvShowId).toBe(tvHierarchy.tvShowId);
      expect(entry.movieId).toBeNull();
    });

    it('rejects MOVIE entry when movie_id is null', async () => {
      await expect(
        prisma.userLibraryEntry.create({
          data: {
            userId: user.id,
            mediaType: MediaType.MOVIE,
            movieId: null,
            tvShowId: null,
            status: LibraryStatus.PLAN_TO_WATCH,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects TV entry when tv_show_id is null', async () => {
      await expect(
        prisma.userLibraryEntry.create({
          data: {
            userId: user.id,
            mediaType: MediaType.TV,
            movieId: null,
            tvShowId: null,
            status: LibraryStatus.WATCHING,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects MOVIE entry when tv_show_id is also populated', async () => {
      await expect(
        prisma.userLibraryEntry.create({
          data: {
            userId: user.id,
            mediaType: MediaType.MOVIE,
            movieId: movie.id,
            tvShowId: tvHierarchy.tvShowId,
            status: LibraryStatus.PLAN_TO_WATCH,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects TV entry when movie_id is also populated', async () => {
      await expect(
        prisma.userLibraryEntry.create({
          data: {
            userId: user.id,
            mediaType: MediaType.TV,
            movieId: movie.id,
            tvShowId: tvHierarchy.tvShowId,
            status: LibraryStatus.WATCHING,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Partial Unique Indexes
  // ────────────────────────────────────────────────────────────────────────────
  describe('Partial Unique Indexes', () => {
    let user1: { id: string };
    let user2: { id: string };
    let movie: { id: string };
    let tvHierarchy: { tvShowId: string; seasonId: string; episodeId: string };

    beforeEach(async () => {
      user1 = await createTestUser();
      user2 = await createTestUser();
      movie = await createTestMovie();
      tvHierarchy = await createTestTvHierarchy();
    });

    it('prevents duplicate movie entries for the same user', async () => {
      await prisma.userLibraryEntry.create({
        data: {
          userId: user1.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      await expect(
        prisma.userLibraryEntry.create({
          data: {
            userId: user1.id,
            mediaType: MediaType.MOVIE,
            movieId: movie.id,
            status: LibraryStatus.COMPLETED,
          },
        }),
      ).rejects.toThrow();
    });

    it('allows different users to have an entry for the same movie', async () => {
      const e1 = await prisma.userLibraryEntry.create({
        data: {
          userId: user1.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      const e2 = await prisma.userLibraryEntry.create({
        data: {
          userId: user2.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.COMPLETED,
        },
      });

      expect(e1.id).toBeDefined();
      expect(e2.id).toBeDefined();
      expect(e1.id).not.toBe(e2.id);
    });

    it('prevents duplicate TV show entries for the same user', async () => {
      await prisma.userLibraryEntry.create({
        data: {
          userId: user1.id,
          mediaType: MediaType.TV,
          tvShowId: tvHierarchy.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await expect(
        prisma.userLibraryEntry.create({
          data: {
            userId: user1.id,
            mediaType: MediaType.TV,
            tvShowId: tvHierarchy.tvShowId,
            status: LibraryStatus.DROPPED,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Trigger Validation: EpisodeProgress & SeasonRating
  // ────────────────────────────────────────────────────────────────────────────
  describe('Trigger Validation: EpisodeProgress & SeasonRating', () => {
    let user: { id: string };
    let movie: { id: string };
    let tv1: { tvShowId: string; seasonId: string; episodeId: string };
    let tv2: { tvShowId: string; seasonId: string; episodeId: string };

    beforeEach(async () => {
      user = await createTestUser();
      movie = await createTestMovie();
      tv1 = await createTestTvHierarchy();
      tv2 = await createTestTvHierarchy();
    });

    it('allows valid EpisodeProgress when episode belongs to entry TV show', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      const ep = await prisma.episodeProgress.create({
        data: {
          libraryEntryId: ule.id,
          episodeId: tv1.episodeId,
        },
      });

      expect(ep.libraryEntryId).toBe(ule.id);
      expect(ep.episodeId).toBe(tv1.episodeId);
    });

    it('rejects EpisodeProgress for a MOVIE library entry', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      await expect(
        prisma.episodeProgress.create({
          data: {
            libraryEntryId: ule.id,
            episodeId: tv1.episodeId,
          },
        }),
      ).rejects.toThrow(/TV library entries/);
    });

    it('rejects EpisodeProgress when episode belongs to a different TV show', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      // tv2.episodeId belongs to tv2, not tv1!
      await expect(
        prisma.episodeProgress.create({
          data: {
            libraryEntryId: ule.id,
            episodeId: tv2.episodeId,
          },
        }),
      ).rejects.toThrow(/tracks tvShow/);
    });

    it('allows valid SeasonRating when season belongs to entry TV show', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      const sr = await prisma.seasonRating.create({
        data: {
          libraryEntryId: ule.id,
          seasonId: tv1.seasonId,
          rating: new Prisma.Decimal('8.50'),
        },
      });

      expect(sr.libraryEntryId).toBe(ule.id);
      expect(sr.seasonId).toBe(tv1.seasonId);
    });

    it('rejects SeasonRating for a MOVIE library entry', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      await expect(
        prisma.seasonRating.create({
          data: {
            libraryEntryId: ule.id,
            seasonId: tv1.seasonId,
            rating: new Prisma.Decimal('8.00'),
          },
        }),
      ).rejects.toThrow(/TV library entries/);
    });

    it('rejects SeasonRating when season belongs to a different TV show', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await expect(
        prisma.seasonRating.create({
          data: {
            libraryEntryId: ule.id,
            seasonId: tv2.seasonId,
            rating: new Prisma.Decimal('7.50'),
          },
        }),
      ).rejects.toThrow(/tracks tvShow/);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Parent-Update Protection Triggers
  // ────────────────────────────────────────────────────────────────────────────
  describe('Parent-Update Protection Triggers', () => {
    let user: { id: string };
    let tv1: { tvShowId: string; seasonId: string; episodeId: string };
    let tv2: { tvShowId: string; seasonId: string; episodeId: string };

    beforeEach(async () => {
      user = await createTestUser();
      tv1 = await createTestTvHierarchy();
      tv2 = await createTestTvHierarchy();
    });

    it('blocks UserLibraryEntry tv_show_id modification when EpisodeProgress exists', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: ule.id,
          episodeId: tv1.episodeId,
        },
      });

      await expect(
        prisma.userLibraryEntry.update({
          where: { id: ule.id },
          data: { tvShowId: tv2.tvShowId },
        }),
      ).rejects.toThrow(/Cannot modify tv_show_id/);
    });

    it('blocks UserLibraryEntry tv_show_id modification when SeasonRating exists', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await prisma.seasonRating.create({
        data: {
          libraryEntryId: ule.id,
          seasonId: tv1.seasonId,
          rating: new Prisma.Decimal('8.00'),
        },
      });

      await expect(
        prisma.userLibraryEntry.update({
          where: { id: ule.id },
          data: { tvShowId: tv2.tvShowId },
        }),
      ).rejects.toThrow(/Cannot modify tv_show_id/);
    });

    it('blocks Episode seasonId modification when EpisodeProgress references it', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: ule.id,
          episodeId: tv1.episodeId,
        },
      });

      await expect(
        prisma.episode.update({
          where: { id: tv1.episodeId },
          data: { seasonId: tv2.seasonId },
        }),
      ).rejects.toThrow(/Cannot reassign seasonId/);
    });

    it('blocks Season tvShowId modification when SeasonRating exists', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await prisma.seasonRating.create({
        data: {
          libraryEntryId: ule.id,
          seasonId: tv1.seasonId,
          rating: new Prisma.Decimal('7.00'),
        },
      });

      await expect(
        prisma.season.update({
          where: { id: tv1.seasonId },
          data: { tvShowId: tv2.tvShowId },
        }),
      ).rejects.toThrow(/Cannot reassign tvShowId/);
    });

    it('blocks Season tvShowId modification when EpisodeProgress references an episode in that season', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: ule.id,
          episodeId: tv1.episodeId,
        },
      });

      await expect(
        prisma.season.update({
          where: { id: tv1.seasonId },
          data: { tvShowId: tv2.tvShowId },
        }),
      ).rejects.toThrow(/Cannot reassign tvShowId/);
    });

    it('allows valid reassignment when no dependent records exist', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tv1.tvShowId,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      // No progress or ratings exist on ule -> update tvShowId succeeds
      const updated = await prisma.userLibraryEntry.update({
        where: { id: ule.id },
        data: { tvShowId: tv2.tvShowId },
      });
      expect(updated.tvShowId).toBe(tv2.tvShowId);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. Foreign-Key Deletion & Cascade / Restrict Invariants
  // ────────────────────────────────────────────────────────────────────────────
  describe('Foreign-Key Deletion Rules', () => {
    let user: { id: string };
    let movie: { id: string };
    let tvHierarchy: { tvShowId: string; seasonId: string; episodeId: string };

    beforeEach(async () => {
      user = await createTestUser();
      movie = await createTestMovie();
      tvHierarchy = await createTestTvHierarchy();
    });

    it('cascades deletion from UserLibraryEntry to ViewingEvent, EpisodeProgress, and SeasonRating', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tvHierarchy.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      const ve = await prisma.viewingEvent.create({
        data: { libraryEntryId: ule.id, rating: new Prisma.Decimal('8.00') },
      });
      await prisma.episodeProgress.create({
        data: { libraryEntryId: ule.id, episodeId: tvHierarchy.episodeId },
      });
      const sr = await prisma.seasonRating.create({
        data: {
          libraryEntryId: ule.id,
          seasonId: tvHierarchy.seasonId,
          rating: new Prisma.Decimal('8.00'),
        },
      });

      // Delete the library entry
      await prisma.userLibraryEntry.delete({ where: { id: ule.id } });

      // Dependent records must be deleted via cascade
      const foundVe = await prisma.viewingEvent.findUnique({ where: { id: ve.id } });
      expect(foundVe).toBeNull();

      const foundEp = await prisma.episodeProgress.findUnique({
        where: {
          libraryEntryId_episodeId: {
            libraryEntryId: ule.id,
            episodeId: tvHierarchy.episodeId,
          },
        },
      });
      expect(foundEp).toBeNull();

      const foundSr = await prisma.seasonRating.findUnique({ where: { id: sr.id } });
      expect(foundSr).toBeNull();
    });

    it('cascades deletion from User to UserLibraryEntry', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      const found = await prisma.userLibraryEntry.findUnique({ where: { id: ule.id } });
      expect(found).toBeNull();
    });

    it('restricts Movie deletion when referenced by UserLibraryEntry', async () => {
      await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.MOVIE,
          movieId: movie.id,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      await expect(prisma.movie.delete({ where: { id: movie.id } })).rejects.toThrow();
    });

    it('restricts TvShow deletion when referenced by UserLibraryEntry', async () => {
      await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tvHierarchy.tvShowId,
          status: LibraryStatus.PLAN_TO_WATCH,
        },
      });

      await expect(prisma.tvShow.delete({ where: { id: tvHierarchy.tvShowId } })).rejects.toThrow();
    });

    it('restricts Episode deletion when referenced by EpisodeProgress', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tvHierarchy.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await prisma.episodeProgress.create({
        data: {
          libraryEntryId: ule.id,
          episodeId: tvHierarchy.episodeId,
        },
      });

      await expect(
        prisma.episode.delete({ where: { id: tvHierarchy.episodeId } }),
      ).rejects.toThrow();
    });

    it('restricts Season deletion when referenced by SeasonRating', async () => {
      const ule = await prisma.userLibraryEntry.create({
        data: {
          userId: user.id,
          mediaType: MediaType.TV,
          tvShowId: tvHierarchy.tvShowId,
          status: LibraryStatus.WATCHING,
        },
      });

      await prisma.seasonRating.create({
        data: {
          libraryEntryId: ule.id,
          seasonId: tvHierarchy.seasonId,
          rating: new Prisma.Decimal('8.00'),
        },
      });

      await expect(prisma.season.delete({ where: { id: tvHierarchy.seasonId } })).rejects.toThrow();
    });
  });
});
