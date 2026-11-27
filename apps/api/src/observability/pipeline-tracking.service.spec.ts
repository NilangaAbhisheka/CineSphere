import { PipelineRunStatus, PipelineTriggerType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import {
  MAX_ERROR_SUMMARY_LENGTH,
  MAX_METADATA_BYTES,
  PIPELINE_ERROR_CODES,
  SAFE_ERROR_SUMMARIES,
} from './observability.constants.js';
import { HeartbeatThrottler, PipelineTrackingService } from './pipeline-tracking.service.js';

describe('PipelineTrackingService', () => {
  let service: PipelineTrackingService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

    service = new PipelineTrackingService(mockPrisma);
  });

  describe('startRun', () => {
    it('creates a RUNNING pipeline run and returns its UUID', async () => {
      const runId = '11111111-1111-4111-8111-111111111111';
      mockPrisma.$queryRaw.mockResolvedValue([{ id: runId }]);

      const result = await service.startRun({
        pipelineName: 'import_json',
        triggerType: PipelineTriggerType.MANUAL,
        metadata: { format: 'json', fileSizeBytes: 512 },
      });

      expect(result).toBe(runId);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid pipeline names without hitting the database', async () => {
      const result = await service.startRun({
        pipelineName: 'Invalid Name With Spaces!',
        triggerType: PipelineTriggerType.MANUAL,
      });

      expect(result).toBeNull();
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns null without throwing when database insert fails', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      const result = await service.startRun({
        pipelineName: 'import_csv',
        triggerType: PipelineTriggerType.MANUAL,
      });

      expect(result).toBeNull();
    });
  });

  describe('completeRun', () => {
    const validRunId = '22222222-2222-4222-8222-222222222222';

    it('treats null or invalid runId as a safe no-op', async () => {
      await service.completeRun(null, { recordsRead: 5 });
      await service.completeRun('not-a-uuid', { recordsRead: 5 });

      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('updates a RUNNING record to SUCCEEDED when no records are rejected', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.completeRun(validRunId, {
        recordsRead: 10,
        recordsInserted: 7,
        recordsSkipped: 3,
      });

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      const queryArgs = mockPrisma.$executeRaw.mock.calls[0];
      expect(queryArgs).toContain(PipelineRunStatus.SUCCEEDED);
    });

    it('defaults to PARTIAL_SUCCESS when recordsRejected > 0', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.completeRun(validRunId, {
        recordsRead: 10,
        recordsInserted: 8,
        recordsRejected: 2,
      });

      const queryArgs = mockPrisma.$executeRaw.mock.calls[0];
      expect(queryArgs).toContain(PipelineRunStatus.PARTIAL_SUCCESS);
    });

    it('clamps negative and non-finite counters to 0', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.completeRun(validRunId, {
        recordsRead: -5,
        recordsInserted: Number.NaN,
        recordsSkipped: 4.9,
        recordsRejected: -1,
      });

      const queryArgs = mockPrisma.$executeRaw.mock.calls[0];
      expect(queryArgs).toContain(0);
      expect(queryArgs).toContain(4);
      expect(queryArgs).not.toContain(-5);
      expect(queryArgs).not.toContain(-1);
    });

    it('does not throw when completeRun hits a database failure or already-finalized row', async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(0);
      await expect(service.completeRun(validRunId, { recordsRead: 1 })).resolves.toBeUndefined();

      mockPrisma.$executeRaw.mockRejectedValueOnce(new Error('DB write error'));
      await expect(service.completeRun(validRunId, { recordsRead: 1 })).resolves.toBeUndefined();
    });
  });

  describe('failRun', () => {
    const validRunId = '33333333-3333-4333-8333-333333333333';

    it('treats null runId as a safe no-op', async () => {
      await service.failRun(null, { errorCode: PIPELINE_ERROR_CODES.VALIDATION_FAILED });
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('maps known error codes to authored safe summaries and strips unsafe inputs', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.failRun(validRunId, {
        errorCode: PIPELINE_ERROR_CODES.VALIDATION_FAILED,
        errorSummary: 'Bearer secret_token_123 failed on SELECT * FROM users',
        recordsRead: 5,
        recordsRejected: 2,
      });

      const queryArgs = mockPrisma.$executeRaw.mock.calls[0];
      expect(queryArgs).toContain(PIPELINE_ERROR_CODES.VALIDATION_FAILED);
      expect(queryArgs).toContain(SAFE_ERROR_SUMMARIES[PIPELINE_ERROR_CODES.VALIDATION_FAILED]);
      expect(JSON.stringify(queryArgs)).not.toContain('secret_token_123');
    });

    it('falls back to safe error code and generic summary for unknown/unsafe error inputs', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await service.failRun(validRunId, {
        errorCode: 'invalid code !!',
        errorSummary: 'postgresql://user:pass@localhost/db SELECT * FROM user_library_entries',
      });

      const queryArgs = mockPrisma.$executeRaw.mock.calls[0];
      expect(queryArgs).toContain(PIPELINE_ERROR_CODES.UNEXPECTED_ERROR);
      expect(JSON.stringify(queryArgs)).not.toContain('pass@localhost');
      expect(JSON.stringify(queryArgs)).not.toContain('user_library_entries');
    });

    it('enforces max summary length for authored custom summaries', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      const longSafeSummary = 'A'.repeat(MAX_ERROR_SUMMARY_LENGTH + 50);

      await service.failRun(validRunId, {
        errorCode: 'CUSTOM_CODE',
        errorSummary: longSafeSummary,
      });

      const queryArgs = mockPrisma.$executeRaw.mock.calls[0];
      expect(JSON.stringify(queryArgs)).not.toContain(longSafeSummary);
    });

    it('does not throw on database failure', async () => {
      mockPrisma.$executeRaw.mockRejectedValue(new Error('DB down'));

      await expect(
        service.failRun(validRunId, { errorCode: PIPELINE_ERROR_CODES.PERSISTENCE_ERROR }),
      ).resolves.toBeUndefined();
    });
  });

  describe('heartbeat', () => {
    const validRunId = '44444444-4444-4444-8444-444444444444';

    it('returns true when exactly one RUNNING record is updated, false otherwise', async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      expect(await service.heartbeat(validRunId)).toBe(true);
      expect(await service.heartbeat(validRunId)).toBe(false);
    });

    it('returns false on null/invalid runId or database error without throwing', async () => {
      expect(await service.heartbeat(null)).toBe(false);
      expect(await service.heartbeat('bad-id')).toBe(false);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();

      mockPrisma.$executeRaw.mockRejectedValueOnce(new Error('Timeout'));
      expect(await service.heartbeat(validRunId)).toBe(false);
    });
  });

  describe('reconcileStaleRuns', () => {
    it('updates stale RUNNING rows and returns affected count', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(2);

      const count = await service.reconcileStaleRuns({ staleAfterMs: 60_000 });
      expect(count).toBe(2);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('ignores invalid pipelineName filters and swallows DB errors safely', async () => {
      expect(await service.reconcileStaleRuns({ pipelineName: 'Bad Pipeline!' })).toBe(0);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();

      mockPrisma.$executeRaw.mockRejectedValue(new Error('DB unavailable'));
      expect(await service.reconcileStaleRuns()).toBe(0);
    });
  });

  describe('sanitizeMetadata', () => {
    it('allows only allowlisted keys with validated safe values', () => {
      const result = service.sanitizeMetadata({
        format: 'json',
        fileSizeBytes: 1024,
        validationErrorCount: 3,
        userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        notes: 'private note',
        tmdbId: 550,
        modelName: 'sentence-transformers/all-mpnet-base-v2',
        modelRevision: '9a3225965996d404b775526de6dbfe85d3368642',
        failurePhase: 'Bearer token_leak',
      });

      expect(result).toEqual({
        format: 'json',
        fileSizeBytes: 1024,
        validationErrorCount: 3,
        modelName: 'sentence-transformers/all-mpnet-base-v2',
        modelRevision: '9a3225965996d404b775526de6dbfe85d3368642',
      });
    });

    it('enforces maximum metadata size limit', () => {
      const result = service.sanitizeMetadata({
        format: 'json',
        fileSizeBytes: 123,
      });
      expect(result).not.toBeNull();
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(
        MAX_METADATA_BYTES,
      );
    });
  });

  describe('HeartbeatThrottler', () => {
    it('skips before 60 seconds, sends at >= 60 seconds, and retries after failed beat', async () => {
      let nowMs = 1_000_000;
      const runId = '55555555-5555-4555-8555-555555555555';
      const throttler = new HeartbeatThrottler(60_000, () => nowMs);
      const mockTracker = {
        heartbeat: jest
          .fn<Promise<boolean>, [string | null]>()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
      };

      // Before 60s elapsed: skipped
      nowMs += 30_000;
      expect(await throttler.maybeBeat(runId, mockTracker)).toBe('skipped');
      expect(mockTracker.heartbeat).not.toHaveBeenCalled();

      // At 60s elapsed: first attempt fails -> eligible for immediate retry at next boundary
      nowMs += 30_000;
      expect(await throttler.maybeBeat(runId, mockTracker)).toBe('failed');
      expect(mockTracker.heartbeat).toHaveBeenCalledTimes(1);

      // Next boundary 5s later: retries immediately because previous beat failed
      nowMs += 5_000;
      expect(await throttler.maybeBeat(runId, mockTracker)).toBe('sent');
      expect(mockTracker.heartbeat).toHaveBeenCalledTimes(2);

      // Next boundary 20s later: skipped because < 60s since last successful beat
      nowMs += 20_000;
      expect(await throttler.maybeBeat(runId, mockTracker)).toBe('skipped');
      expect(mockTracker.heartbeat).toHaveBeenCalledTimes(2);

      // 40s more (total 60s since last success): sends again
      nowMs += 40_000;
      expect(await throttler.maybeBeat(runId, mockTracker)).toBe('sent');
      expect(mockTracker.heartbeat).toHaveBeenCalledTimes(3);
    });
  });
});
