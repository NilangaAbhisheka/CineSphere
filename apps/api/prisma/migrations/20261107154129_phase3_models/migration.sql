-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('MOVIE', 'TV');

-- CreateEnum
CREATE TYPE "LibraryStatus" AS ENUM ('PLAN_TO_WATCH', 'WATCHING', 'COMPLETED', 'DROPPED');

-- DropForeignKey
ALTER TABLE "_GenreToMovie" DROP CONSTRAINT "_GenreToMovie_A_fkey";

-- DropForeignKey
ALTER TABLE "_GenreToMovie" DROP CONSTRAINT "_GenreToMovie_B_fkey";

-- DropForeignKey
ALTER TABLE "_GenreToTvShow" DROP CONSTRAINT "_GenreToTvShow_A_fkey";

-- DropForeignKey
ALTER TABLE "_GenreToTvShow" DROP CONSTRAINT "_GenreToTvShow_B_fkey";

-- DropForeignKey
ALTER TABLE "_KeywordToMovie" DROP CONSTRAINT "_KeywordToMovie_A_fkey";

-- DropForeignKey
ALTER TABLE "_KeywordToMovie" DROP CONSTRAINT "_KeywordToMovie_B_fkey";

-- DropForeignKey
ALTER TABLE "_KeywordToTvShow" DROP CONSTRAINT "_KeywordToTvShow_A_fkey";

-- DropForeignKey
ALTER TABLE "_KeywordToTvShow" DROP CONSTRAINT "_KeywordToTvShow_B_fkey";

-- DropForeignKey
ALTER TABLE "episodes" DROP CONSTRAINT "episodes_seasonId_fkey";

-- DropForeignKey
ALTER TABLE "person_credits" DROP CONSTRAINT "person_credits_movieId_fkey";

-- DropForeignKey
ALTER TABLE "person_credits" DROP CONSTRAINT "person_credits_personId_fkey";

-- DropForeignKey
ALTER TABLE "person_credits" DROP CONSTRAINT "person_credits_tvShowId_fkey";

-- DropForeignKey
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_tvShowId_fkey";

-- CreateTable
CREATE TABLE "user_library_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "media_type" "MediaType" NOT NULL,
    "movie_id" UUID,
    "tv_show_id" UUID,
    "status" "LibraryStatus" NOT NULL,
    "personal_rating" DECIMAL(4,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_library_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewing_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "library_entry_id" UUID NOT NULL,
    "watched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" DECIMAL(4,2),
    "notes" TEXT,

    CONSTRAINT "viewing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "episode_progress" (
    "library_entry_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "watched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "episode_progress_pkey" PRIMARY KEY ("library_entry_id","episode_id")
);

-- CreateTable
CREATE TABLE "season_ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "library_entry_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "rating" DECIMAL(4,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "season_ratings_library_entry_id_season_id_key" ON "season_ratings"("library_entry_id", "season_id");

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_tvShowId_fkey" FOREIGN KEY ("tvShowId") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_credits" ADD CONSTRAINT "person_credits_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_credits" ADD CONSTRAINT "person_credits_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_credits" ADD CONSTRAINT "person_credits_tvShowId_fkey" FOREIGN KEY ("tvShowId") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_library_entries" ADD CONSTRAINT "user_library_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_library_entries" ADD CONSTRAINT "user_library_entries_movie_id_fkey" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_library_entries" ADD CONSTRAINT "user_library_entries_tv_show_id_fkey" FOREIGN KEY ("tv_show_id") REFERENCES "tv_shows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_events" ADD CONSTRAINT "viewing_events_library_entry_id_fkey" FOREIGN KEY ("library_entry_id") REFERENCES "user_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_library_entry_id_fkey" FOREIGN KEY ("library_entry_id") REFERENCES "user_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_ratings" ADD CONSTRAINT "season_ratings_library_entry_id_fkey" FOREIGN KEY ("library_entry_id") REFERENCES "user_library_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_ratings" ADD CONSTRAINT "season_ratings_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GenreToMovie" ADD CONSTRAINT "_GenreToMovie_A_fkey" FOREIGN KEY ("A") REFERENCES "genres"("tmdbId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GenreToMovie" ADD CONSTRAINT "_GenreToMovie_B_fkey" FOREIGN KEY ("B") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GenreToTvShow" ADD CONSTRAINT "_GenreToTvShow_A_fkey" FOREIGN KEY ("A") REFERENCES "genres"("tmdbId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GenreToTvShow" ADD CONSTRAINT "_GenreToTvShow_B_fkey" FOREIGN KEY ("B") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KeywordToMovie" ADD CONSTRAINT "_KeywordToMovie_A_fkey" FOREIGN KEY ("A") REFERENCES "keywords"("tmdbId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KeywordToMovie" ADD CONSTRAINT "_KeywordToMovie_B_fkey" FOREIGN KEY ("B") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KeywordToTvShow" ADD CONSTRAINT "_KeywordToTvShow_A_fkey" FOREIGN KEY ("A") REFERENCES "keywords"("tmdbId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_KeywordToTvShow" ADD CONSTRAINT "_KeywordToTvShow_B_fkey" FOREIGN KEY ("B") REFERENCES "tv_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
