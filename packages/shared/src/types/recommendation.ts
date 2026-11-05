export type DiversityMode = 'safe' | 'balanced' | 'experimental';

export type RecommendationFeedbackType =
  | 'interested'
  | 'not_interested'
  | 'already_watched'
  | 'not_my_type'
  | 'watched_and_loved'
  | 'watched_and_disappointed';

export interface RecommendationScoreBreakdown {
  semanticSimilarity: number; // S (0.35)
  preferenceMatch: number; // P (0.25)
  moodMatch: number; // M (0.20)
  qualitySignal: number; // Q (0.10)
  noveltyScore: number; // N (0.10)
  totalScore: number; // Composite
}

export interface RecommendationItemDTO {
  mediaId: string;
  title: string;
  mediaType: 'movie' | 'tv';
  posterPath: string | null;
  score: RecommendationScoreBreakdown;
  reason: string;
  diversityMode: DiversityMode;
}
