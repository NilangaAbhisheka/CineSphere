import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { VectorExtensionStatus } from '@cinesphere/shared';

interface ExtensionRow {
  name: string;
  installed_version: string | null;
  comment: string | null;
}

interface DistanceRow {
  distance: number;
}

@Injectable()
export class VectorRepository {
  private readonly logger = new Logger(VectorRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if the PostgreSQL pgvector extension is installed and get version metadata.
   */
  async isPgvectorInstalled(): Promise<VectorExtensionStatus> {
    try {
      const rows = await this.prisma.$queryRaw<ExtensionRow[]>`
        SELECT name, installed_version, comment
        FROM pg_available_extensions
        WHERE name = 'vector'
        LIMIT 1;
      `;

      if (rows && rows.length > 0 && rows[0].installed_version) {
        return {
          installed: true,
          version: rows[0].installed_version,
          comment: rows[0].comment,
        };
      }

      return {
        installed: false,
        version: null,
        comment: null,
      };
    } catch (error) {
      this.logger.warn('Failed to query pg_extension status', error);
      return {
        installed: false,
        version: null,
        comment: error instanceof Error ? error.message : 'Database query failed',
      };
    }
  }

  /**
   * Test a parameterized vector calculation to verify that pgvector operators (<=>) work.
   * Compares collinear vectors [1, 2, 3] and [2, 4, 6], where cosine distance is 0 and similarity is 1.0.
   */
  async testVectorCosineSimilarity(): Promise<{
    sampleCosineDistance: number;
    sampleCosineSimilarity: number;
    success: boolean;
  }> {
    try {
      const rows = await this.prisma.$queryRaw<DistanceRow[]>`
        SELECT ('[1, 2, 3]'::vector <=> '[2, 4, 6]'::vector)::float AS distance;
      `;

      if (rows && rows.length > 0) {
        const distance = Number(rows[0].distance);
        return {
          sampleCosineDistance: distance,
          sampleCosineSimilarity: 1 - distance,
          success: true,
        };
      }

      return {
        sampleCosineDistance: -1,
        sampleCosineSimilarity: -1,
        success: false,
      };
    } catch (error) {
      this.logger.error('Failed to run test vector operation in PostgreSQL', error);
      return {
        sampleCosineDistance: -1,
        sampleCosineSimilarity: -1,
        success: false,
      };
    }
  }
}
