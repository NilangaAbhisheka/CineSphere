export type WatchStatus = 'watching' | 'completed' | 'plan_to_watch' | 'dropped';

export interface UserLibraryEntryDTO {
  id: string;
  userId: string;
  mediaId: string;
  status: WatchStatus;
  personalRating?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  addedAt: string;
  updatedAt: string;
}

export interface WatchProgressDTO {
  id: string;
  libraryEntryId: string;
  currentSeasonNumber: number;
  currentEpisodeNumber: number;
  lastWatchedAt: string;
}
