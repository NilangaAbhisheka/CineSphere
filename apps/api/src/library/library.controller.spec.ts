import {
  EpisodeProgressResponse,
  LibraryEntryResponse,
  SeasonRatingResponse,
  ViewingEventResponse,
} from '@cinesphere/shared';
import { LibraryStatus, MediaType } from '@prisma/client';
import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';

describe('LibraryController', () => {
  let controller: LibraryController;
  let libraryService: jest.Mocked<LibraryService>;

  const MOCK_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const MOCK_EPISODE_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
  const MOCK_SEASON_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';

  beforeEach(() => {
    libraryService = {
      createLibraryEntry: jest.fn(),
      listLibrary: jest.fn(),
      getLibraryEntry: jest.fn(),
      updateLibraryEntry: jest.fn(),
      deleteLibraryEntry: jest.fn(),
      createViewingEvent: jest.fn(),
      createEpisodeProgress: jest.fn(),
      deleteEpisodeProgress: jest.fn(),
      markAllWatched: jest.fn(),
      createSeasonRating: jest.fn(),
      updateSeasonRating: jest.fn(),
    } as unknown as jest.Mocked<LibraryService>;

    controller = new LibraryController(libraryService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('delegates createLibraryEntry to service', async () => {
    const dto = { mediaType: MediaType.MOVIE, tmdbId: 550, status: LibraryStatus.PLAN_TO_WATCH };
    libraryService.createLibraryEntry.mockResolvedValueOnce({
      id: MOCK_ID,
    } as unknown as LibraryEntryResponse);

    const res = await controller.createLibraryEntry(dto);
    expect(res.id).toBe(MOCK_ID);
    expect(libraryService.createLibraryEntry).toHaveBeenCalledWith(dto);
  });

  it('delegates listLibrary to service', async () => {
    libraryService.listLibrary.mockResolvedValueOnce({
      items: [],
      totalResults: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    const res = await controller.listLibrary({
      page: 1,
      limit: 20,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    expect(res.totalResults).toBe(0);
  });

  it('delegates getLibraryEntry to service', async () => {
    libraryService.getLibraryEntry.mockResolvedValueOnce({
      id: MOCK_ID,
    } as unknown as LibraryEntryResponse);
    const res = await controller.getLibraryEntry(MOCK_ID);
    expect(res.id).toBe(MOCK_ID);
    expect(libraryService.getLibraryEntry).toHaveBeenCalledWith(MOCK_ID);
  });

  it('delegates updateLibraryEntry to service', async () => {
    const dto = { status: LibraryStatus.COMPLETED };
    libraryService.updateLibraryEntry.mockResolvedValueOnce({
      id: MOCK_ID,
      status: LibraryStatus.COMPLETED,
    } as unknown as LibraryEntryResponse);
    const res = await controller.updateLibraryEntry(MOCK_ID, dto);
    expect(res.status).toBe(LibraryStatus.COMPLETED);
    expect(libraryService.updateLibraryEntry).toHaveBeenCalledWith(MOCK_ID, dto);
  });

  it('delegates deleteLibraryEntry to service', async () => {
    await controller.deleteLibraryEntry(MOCK_ID);
    expect(libraryService.deleteLibraryEntry).toHaveBeenCalledWith(MOCK_ID);
  });

  it('delegates createViewingEvent to service', async () => {
    const dto = { rating: 9.0 };
    libraryService.createViewingEvent.mockResolvedValueOnce({
      id: 'v1',
      rating: 9.0,
    } as unknown as ViewingEventResponse);
    const res = await controller.createViewingEvent(MOCK_ID, dto);
    expect(res.rating).toBe(9.0);
    expect(libraryService.createViewingEvent).toHaveBeenCalledWith(MOCK_ID, dto);
  });

  it('delegates createEpisodeProgress to service', async () => {
    const dto = { episodeId: MOCK_EPISODE_ID };
    libraryService.createEpisodeProgress.mockResolvedValueOnce({
      episodeId: MOCK_EPISODE_ID,
      alreadyWatched: false,
    } as unknown as EpisodeProgressResponse);
    const res = await controller.createEpisodeProgress(MOCK_ID, dto);
    expect(res.alreadyWatched).toBe(false);
  });

  it('delegates deleteEpisodeProgress to service', async () => {
    await controller.deleteEpisodeProgress(MOCK_ID, MOCK_EPISODE_ID);
    expect(libraryService.deleteEpisodeProgress).toHaveBeenCalledWith(MOCK_ID, MOCK_EPISODE_ID);
  });

  it('delegates markAllWatched to service', async () => {
    libraryService.markAllWatched.mockResolvedValueOnce({ addedCount: 10 });
    const res = await controller.markAllWatched(MOCK_ID, { includeSpecials: false });
    expect(res.addedCount).toBe(10);
  });

  it('delegates createSeasonRating to service', async () => {
    const dto = { seasonId: MOCK_SEASON_ID, rating: 8.5 };
    libraryService.createSeasonRating.mockResolvedValueOnce({
      rating: 8.5,
    } as unknown as SeasonRatingResponse);
    const res = await controller.createSeasonRating(MOCK_ID, dto);
    expect(res.rating).toBe(8.5);
  });

  it('delegates updateSeasonRating to service', async () => {
    const dto = { rating: 9.5 };
    libraryService.updateSeasonRating.mockResolvedValueOnce({
      rating: 9.5,
    } as unknown as SeasonRatingResponse);
    const res = await controller.updateSeasonRating(MOCK_ID, MOCK_SEASON_ID, dto);
    expect(res.rating).toBe(9.5);
  });
});
