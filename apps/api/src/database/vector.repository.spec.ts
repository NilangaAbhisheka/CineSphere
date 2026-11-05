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
});
