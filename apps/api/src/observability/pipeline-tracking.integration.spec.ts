import { PipelineRunStatus, PipelineTriggerType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PIPELINE_ERROR_CODES } from './observability.constants.js';
import { PipelineTrackingService } from './pipeline-tracking.service.js';

interface ConstraintRow {
  conname: string;
  contype: string;
  definition: string;
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}

interface EnumRow {
  enumlabel: string;
}

describe('PipelineTrackingService PostgreSQL Integration Tests', () => {
  let prisma: PrismaService;
  let service: PipelineTrackingService;
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new PipelineTrackingService(prisma);
  });

  afterEach(async () => {
    if (createdRunIds.length > 0) {
      await prisma.pipelineRun.deleteMany({
        where: { id: { in: [...createdRunIds] } },
      });
      createdRunIds.length = 0;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  describe('PostgreSQL Catalog Verification', () => {
    it('verifies all three named CHECK constraints and zero foreign keys on pipeline_runs', async () => {
      const constraints = await prisma.$queryRaw<ConstraintRow[]>`
        SELECT
          c.conname,
          c.contype::text AS contype,
          pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'pipeline_runs'
      `;

      const fks = constraints.filter((c) => c.contype === 'f');
      expect(fks).toHaveLength(0);

      const checks = new Map(
        constraints.filter((c) => c.contype === 'c').map((c) => [c.conname, c.definition]),
      );

      expect(checks.has('chk_pipeline_runs_counters_non_negative')).toBe(true);
      expect(checks.get('chk_pipeline_runs_counters_non_negative')).toContain('records_read >= 0');
      expect(checks.get('chk_pipeline_runs_counters_non_negative')).toContain(
        'records_rejected >= 0',
      );

      expect(checks.has('chk_pipeline_runs_completed_after_started')).toBe(true);
      expect(checks.get('chk_pipeline_runs_completed_after_started')).toContain(
        'completed_at >= started_at',
      );

      expect(checks.has('chk_pipeline_runs_lifecycle_consistency')).toBe(true);
      expect(checks.get('chk_pipeline_runs_lifecycle_consistency')).toContain('RUNNING');
      expect(checks.get('chk_pipeline_runs_lifecycle_consistency')).toContain('completed_at');
    });

    it('verifies partial index idx_pipeline_runs_active_heartbeat and B-tree indexes', async () => {
      const indexes = await prisma.$queryRaw<IndexRow[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'pipeline_runs'
      `;

      const indexMap = new Map(indexes.map((i) => [i.indexname, i.indexdef]));

      expect(indexMap.has('idx_pipeline_runs_name_started')).toBe(true);
      expect(indexMap.has('idx_pipeline_runs_status_started')).toBe(true);

      const partialDef = indexMap.get('idx_pipeline_runs_active_heartbeat');
      expect(partialDef).toBeDefined();
      expect(partialDef).toContain('heartbeat_at');
      expect(partialDef).toContain('started_at');
      expect(partialDef).toMatch(/WHERE\s+\(status\s*=\s*'RUNNING'::"PipelineRunStatus"\)/);
    });

    it('verifies enum values and column types/nullability on pipeline_runs', async () => {
      const statusEnums = await prisma.$queryRaw<EnumRow[]>`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'PipelineRunStatus'
        ORDER BY e.enumsortorder
      `;
      expect(statusEnums.map((r) => r.enumlabel)).toEqual([
        'RUNNING',
        'SUCCEEDED',
        'PARTIAL_SUCCESS',
        'FAILED',
        'TIMED_OUT',
      ]);

      const triggerEnums = await prisma.$queryRaw<EnumRow[]>`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'PipelineTriggerType'
        ORDER BY e.enumsortorder
      `;
      expect(triggerEnums.map((r) => r.enumlabel)).toEqual([
        'MANUAL',
        'SCHEDULED',
        'SYSTEM',
        'CLI',
      ]);

      const columns = await prisma.$queryRaw<ColumnRow[]>`
        SELECT column_name, data_type, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pipeline_runs'
      `;
      const colMap = new Map(columns.map((c) => [c.column_name, c]));

      expect(colMap.get('id')).toMatchObject({ udt_name: 'uuid', is_nullable: 'NO' });
      expect(colMap.get('pipeline_name')).toMatchObject({
        data_type: 'character varying',
        is_nullable: 'NO',
      });
      expect(colMap.get('trigger_type')).toMatchObject({
        udt_name: 'PipelineTriggerType',
        is_nullable: 'NO',
      });
      expect(colMap.get('status')).toMatchObject({
        udt_name: 'PipelineRunStatus',
        is_nullable: 'NO',
      });
      expect(colMap.get('started_at')).toMatchObject({
        udt_name: 'timestamptz',
        is_nullable: 'NO',
      });
      expect(colMap.get('completed_at')).toMatchObject({
        udt_name: 'timestamptz',
        is_nullable: 'YES',
      });
      expect(colMap.get('heartbeat_at')).toMatchObject({
        udt_name: 'timestamptz',
        is_nullable: 'YES',
      });
      expect(colMap.get('metadata')).toMatchObject({ udt_name: 'jsonb', is_nullable: 'YES' });
      expect(colMap.get('updated_at')).toMatchObject({
        udt_name: 'timestamptz',
        is_nullable: 'NO',
      });
    });
  });

  describe('Database Constraint Enforcement', () => {
    it('rejects negative counters via chk_pipeline_runs_counters_non_negative', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO "pipeline_runs" ("pipeline_name", "trigger_type", "records_read")
          VALUES ('test_neg', 'MANUAL'::"PipelineTriggerType", -1)
        `,
      ).rejects.toThrow(/chk_pipeline_runs_counters_non_negative/);
    });

    it('rejects completed_at < started_at via chk_pipeline_runs_completed_after_started', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO "pipeline_runs" ("pipeline_name", "trigger_type", "status", "started_at", "completed_at")
          VALUES (
            'test_time',
            'MANUAL'::"PipelineTriggerType",
            'SUCCEEDED'::"PipelineRunStatus",
            clock_timestamp(),
            clock_timestamp() - INTERVAL '1 minute'
          )
        `,
      ).rejects.toThrow(/chk_pipeline_runs_completed_after_started/);
    });

    it('rejects RUNNING with non-null completed_at and terminal status with NULL completed_at', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO "pipeline_runs" ("pipeline_name", "trigger_type", "status", "completed_at")
          VALUES (
            'test_lc_1',
            'MANUAL'::"PipelineTriggerType",
            'RUNNING'::"PipelineRunStatus",
            clock_timestamp()
          )
        `,
      ).rejects.toThrow(/chk_pipeline_runs_lifecycle_consistency/);

      await expect(
        prisma.$executeRaw`
          INSERT INTO "pipeline_runs" ("pipeline_name", "trigger_type", "status", "completed_at")
          VALUES (
            'test_lc_2',
            'MANUAL'::"PipelineTriggerType",
            'SUCCEEDED'::"PipelineRunStatus",
            NULL
          )
        `,
      ).rejects.toThrow(/chk_pipeline_runs_lifecycle_consistency/);
    });
  });

  describe('Lifecycle, Clock Consistency & Concurrency', () => {
    it('persists start, heartbeat, and completeRun with monotonic database timestamps and protects terminal state', async () => {
      const runId = await service.startRun({
        pipelineName: 'import_json',
        triggerType: PipelineTriggerType.MANUAL,
        metadata: { format: 'json', fileSizeBytes: 256 },
      });
      expect(runId).toBeTruthy();
      createdRunIds.push(runId!);

      const beatOk = await service.heartbeat(runId);
      expect(beatOk).toBe(true);

      await service.completeRun(runId, {
        recordsRead: 5,
        recordsInserted: 4,
        recordsSkipped: 1,
        recordsRejected: 0,
      });

      const persisted = await prisma.pipelineRun.findUniqueOrThrow({ where: { id: runId! } });
      expect(persisted.status).toBe(PipelineRunStatus.SUCCEEDED);
      expect(persisted.completedAt).not.toBeNull();
      expect(persisted.heartbeatAt).not.toBeNull();
      expect(persisted.heartbeatAt!.getTime()).toBeGreaterThanOrEqual(
        persisted.startedAt.getTime(),
      );
      expect(persisted.completedAt!.getTime()).toBeGreaterThanOrEqual(
        persisted.heartbeatAt!.getTime(),
      );
      expect(persisted.recordsRead).toBe(5);
      expect(persisted.recordsInserted).toBe(4);
      expect(persisted.recordsSkipped).toBe(1);

      // Subsequent failRun / heartbeat must NOT overwrite finalized SUCCEEDED run
      await service.failRun(runId, { errorCode: PIPELINE_ERROR_CODES.UNEXPECTED_ERROR });
      expect(await service.heartbeat(runId)).toBe(false);

      const afterAttempt = await prisma.pipelineRun.findUniqueOrThrow({ where: { id: runId! } });
      expect(afterAttempt.status).toBe(PipelineRunStatus.SUCCEEDED);
      expect(afterAttempt.errorCode).toBeNull();
    });

    it('reconciles stale RUNNING runs atomically and idempotently without affecting fresh runs', async () => {
      const staleId = await service.startRun({
        pipelineName: 'obs_test_stale',
        triggerType: PipelineTriggerType.CLI,
      });
      const freshId = await service.startRun({
        pipelineName: 'obs_test_stale',
        triggerType: PipelineTriggerType.CLI,
      });
      createdRunIds.push(staleId!, freshId!);

      // Backdate staleId heartbeat by 20 minutes directly in PostgreSQL
      await prisma.$executeRaw`
        UPDATE "pipeline_runs"
        SET "started_at" = clock_timestamp() - INTERVAL '25 minutes',
            "heartbeat_at" = clock_timestamp() - INTERVAL '20 minutes'
        WHERE "id" = ${staleId!}::uuid
      `;

      const [r1, r2] = await Promise.all([
        service.reconcileStaleRuns({
          pipelineName: 'obs_test_stale',
          staleAfterMs: 15 * 60 * 1000,
        }),
        service.reconcileStaleRuns({
          pipelineName: 'obs_test_stale',
          staleAfterMs: 15 * 60 * 1000,
        }),
      ]);

      expect(r1 + r2).toBe(1);

      const staleRow = await prisma.pipelineRun.findUniqueOrThrow({ where: { id: staleId! } });
      const freshRow = await prisma.pipelineRun.findUniqueOrThrow({ where: { id: freshId! } });

      expect(staleRow.status).toBe(PipelineRunStatus.TIMED_OUT);
      expect(staleRow.errorCode).toBe(PIPELINE_ERROR_CODES.STALE_EXECUTION_TIMEOUT);
      expect(staleRow.completedAt).not.toBeNull();

      expect(freshRow.status).toBe(PipelineRunStatus.RUNNING);
      expect(freshRow.completedAt).toBeNull();
    });

    it('handles concurrent completeRun and reconcileStaleRuns safely without error or invalid state', async () => {
      const runId = await service.startRun({
        pipelineName: 'obs_test_race',
        triggerType: PipelineTriggerType.MANUAL,
      });
      createdRunIds.push(runId!);

      await prisma.$executeRaw`
        UPDATE "pipeline_runs"
        SET "started_at" = clock_timestamp() - INTERVAL '20 minutes',
            "heartbeat_at" = clock_timestamp() - INTERVAL '20 minutes'
        WHERE "id" = ${runId!}::uuid
      `;

      await Promise.all([
        service.completeRun(runId, { recordsRead: 3, recordsInserted: 3 }),
        service.reconcileStaleRuns({ pipelineName: 'obs_test_race', staleAfterMs: 60_000 }),
      ]);

      const row = await prisma.pipelineRun.findUniqueOrThrow({ where: { id: runId! } });
      expect([PipelineRunStatus.SUCCEEDED, PipelineRunStatus.TIMED_OUT]).toContain(row.status);
      expect(row.completedAt).not.toBeNull();
    });
  });
});
