import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { VectorExtensionStatus, VectorValidationResult } from '@cinesphere/shared';

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
   * Serialize a number array into pgvector literal format: '[0.1, 0.2, 0.3]'.
   * Validates array non-emptiness, element finiteness, and prevents NaN or Infinity injection.
   */
  serializeVector(vector: number[], expectedDimension?: number): VectorValidationResult {
    if (!Array.isArray(vector) || vector.length === 0) {
      return { valid: false, error: 'Vector must be a non-empty array of numbers' };
    }

    if (expectedDimension !== undefined && vector.length !== expectedDimension) {
      return {
        valid: false,
        error: `Vector dimension mismatch: expected ${expectedDimension}, got ${vector.length}`,
      };
    }

    let isZeroVector = true;
    for (let i = 0; i < vector.length; i++) {
      const val = vector[i];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        return {
          valid: false,
          error: `Vector contains invalid element at index ${i}: ${val}`,
        };
      }
      if (val !== 0) {
        isZeroVector = false;
      }
    }

    if (isZeroVector) {
      return {
        valid: false,
        error: 'Vector cannot be an all-zero vector (cosine similarity is undefined)',
      };
    }

    // Format safely as JSON-like array string: '[v1, v2, ...]'
    return {
      valid: true,
      serialized: `[${vector.join(',')}]`,
    };
  }

  /**
   * Deserialize a pgvector string representation ('[0.1,0.2,...]') into a number array.
   */
  deserializeVector(vectorStr: string | null | undefined): number[] | null {
    if (!vectorStr || typeof vectorStr !== 'string') {
      return null;
    }

    const trimmed = vectorStr.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
      return null;
    }

    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }

    const elements = inner.split(',').map((s) => Number(s.trim()));
    if (elements.some((num) => !Number.isFinite(num))) {
      return null;
    }

    return elements;
  }

  /**
   * Convert pgvector cosine distance (0 to 2) to cosine similarity (-1 to 1).
   * Cosine distance <=> is defined as 1 - cosine_similarity.
   * Therefore, cosine_similarity = 1 - cosine_distance.
   * Clamp result safely within [-1, 1] to avoid float precision drift.
   */
  distanceToSimilarity(cosineDistance: number): number {
    if (isNaN(cosineDistance) || !Number.isFinite(cosineDistance)) {
      return 0;
    }
    const similarity = 1 - cosineDistance;
    return Math.max(-1, Math.min(1, similarity));
  }

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
          sampleCosineSimilarity: this.distanceToSimilarity(distance),
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
