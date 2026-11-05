export interface VectorSearchQuery {
  vector: number[];
  limit?: number;
  threshold?: number;
}

export interface SimilarMediaResult {
  mediaId: string;
  cosineDistance: number;
  similarityScore: number;
}

export interface VectorExtensionStatus {
  installed: boolean;
  version: string | null;
  comment: string | null;
}
