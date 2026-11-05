import { VectorRepository } from './vector.repository';
import { PrismaService } from './prisma.service';

describe('VectorRepository', () => {
  let repository: VectorRepository;
  let prismaService: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prismaService = {
      $queryRaw: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

    repository = new VectorRepository(prismaService);
  });

  describe('isPgvectorInstalled', () => {
    it('should return installed: true with version when pg_extension returns vector', async () => {
      prismaService.$queryRaw.mockResolvedValueOnce([
        {
          name: 'vector',
          installed_version: '0.8.0',
          comment: 'vector data type and ivfflat and hnsw access methods',
        },
      ]);

      const result = await repository.isPgvectorInstalled();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('0.8.0');
      expect(result.comment).toContain('vector data type');
    });

    it('should return installed: false when pg_extension does not find vector', async () => {
      prismaService.$queryRaw.mockResolvedValueOnce([]);

      const result = await repository.isPgvectorInstalled();

      expect(result.installed).toBe(false);
      expect(result.version).toBeNull();
    });

    it('should handle database errors gracefully without throwing', async () => {
      prismaService.$queryRaw.mockRejectedValueOnce(new Error('Connection terminated'));

      const result = await repository.isPgvectorInstalled();

      expect(result.installed).toBe(false);
      expect(result.comment).toContain('Connection terminated');
    });
  });

  describe('testVectorCosineSimilarity', () => {
    it('should correctly calculate sample cosine distance and similarity for collinear vectors', async () => {
      // For collinear vectors [1,2,3] <=> [2,4,6], distance is 0.0
      prismaService.$queryRaw.mockResolvedValueOnce([{ distance: 0.0 }]);

      const result = await repository.testVectorCosineSimilarity();

      expect(result.success).toBe(true);
      expect(result.sampleCosineDistance).toBe(0.0);
      expect(result.sampleCosineSimilarity).toBe(1.0);
    });

    it('should return success: false when vector calculation query fails', async () => {
      prismaService.$queryRaw.mockRejectedValueOnce(new Error('Syntax error'));

      const result = await repository.testVectorCosineSimilarity();

      expect(result.success).toBe(false);
      expect(result.sampleCosineDistance).toBe(-1);
    });
  });

  describe('serializeVector', () => {
    it('should serialize valid number array to pgvector literal format', () => {
      const res = repository.serializeVector([0.1, 0.25, -0.75]);
      expect(res.valid).toBe(true);
      expect(res.serialized).toBe('[0.1,0.25,-0.75]');
    });

    it('should reject non-array or empty array', () => {
      expect(repository.serializeVector([]).valid).toBe(false);
      expect(repository.serializeVector(null as unknown as number[]).valid).toBe(false);
    });

    it('should reject arrays containing NaN or Infinity', () => {
      expect(repository.serializeVector([1.0, NaN, 2.0]).valid).toBe(false);
      expect(repository.serializeVector([1.0, Infinity]).valid).toBe(false);
    });

    it('should reject all-zero vectors where cosine similarity is undefined', () => {
      const res = repository.serializeVector([0, 0, 0]);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('all-zero');
    });

    it('should enforce expected dimension when specified', () => {
      expect(repository.serializeVector([1, 2], 3).valid).toBe(false);
      expect(repository.serializeVector([1, 2, 3], 3).valid).toBe(true);
    });
  });

  describe('deserializeVector', () => {
    it('should parse valid vector strings into number arrays', () => {
      const vec = repository.deserializeVector('[0.1, 0.25, -0.75]');
      expect(vec).toEqual([0.1, 0.25, -0.75]);
    });

    it('should return null for invalid, non-string, or malformed inputs', () => {
      expect(repository.deserializeVector(null)).toBeNull();
      expect(repository.deserializeVector('invalid')).toBeNull();
      expect(repository.deserializeVector('[1, abc]')).toBeNull();
    });

    it('should handle empty brackets gracefully', () => {
      expect(repository.deserializeVector('[]')).toEqual([]);
    });
  });

  describe('distanceToSimilarity', () => {
    it('should accurately convert distance to similarity', () => {
      expect(repository.distanceToSimilarity(0)).toBe(1);
      expect(repository.distanceToSimilarity(1)).toBe(0);
      expect(repository.distanceToSimilarity(2)).toBe(-1);
    });

    it('should clamp values to [-1, 1] range', () => {
      expect(repository.distanceToSimilarity(-0.0001)).toBe(1);
      expect(repository.distanceToSimilarity(2.0001)).toBe(-1);
    });

    it('should return 0 for NaN or infinite distances', () => {
      expect(repository.distanceToSimilarity(NaN)).toBe(0);
      expect(repository.distanceToSimilarity(Infinity)).toBe(0);
    });
  });
});
