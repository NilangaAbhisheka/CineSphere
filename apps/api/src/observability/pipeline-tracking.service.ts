import { Injectable, Logger } from '@nestjs/common';
import { PipelineRunStatus, PipelineTriggerType } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service.js';
import {
  ALLOWED_METADATA_KEYS,
  DEFAULT_STALE_THRESHOLD_MS,
  GENERIC_SAFE_ERROR_SUMMARY,
  IMPORT_HEARTBEAT_INTERVAL_MS,
  MAX_ERROR_CODE_LENGTH,
  MAX_ERROR_SUMMARY_LENGTH,
  MAX_METADATA_BYTES,
  MAX_PIPELINE_NAME_LENGTH,
  PIPELINE_ERROR_CODES,
  SAFE_ERROR_SUMMARIES,
} from './observability.constants.js';
import {
  AllowedMetadataKey,
  CompleteRunInput,
  FailRunInput,
  HeartbeatAttemptOutcome,
  NormalizedRunCounters,
  PipelineMetadata,
  ReconcileStaleRunsOptions,
  RunCounters,
  StartRunInput,
} from './observability.types.js';

interface CreatedRunRow {
  id: string;
}

const PIPELINE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/;
const SAFE_STRING_TOKEN_PATTERN = /^[a-zA-Z0-9._:/-]{1,120}$/;
const SAFE_SUMMARY_PATTERN = /^[a-zA-Z0-9 .,;:_()/'"\-]+$/;
const UNSAFE_TEXT_PATTERNS = [
  /bearer\s+/i,
  /https?:\/\//i,
  /postgresql:\/\//i,
  /postgres:\/\//i,
  /SELECT\s+.+\s+FROM/i,
  /INSERT\s+INTO/i,
  /UPDATE\s+.+\s+SET/i,
  /DELETE\s+FROM/i,
  /password|token|secret|authorization/i,
];

const ALLOWED_METADATA_KEY_SET: ReadonlySet<string> = new Set(ALLOWED_METADATA_KEYS);

const NUMERIC_METADATA_KEYS: ReadonlySet<AllowedMetadataKey> = new Set([
  'fileSizeBytes',
  'validationErrorCount',
  'dimensions',
  'batchSize',
  'batchesSucceeded',
  'batchesFailed',
  'pagesProcessed',
  'partialTvCount',
  'fencingToken',
]);

const STRING_METADATA_KEYS: ReadonlySet<AllowedMetadataKey> = new Set([
  'format',
  'failurePhase',
  'modelName',
  'modelRevision',
  'device',
  'leaseName',
]);

export class HeartbeatThrottler {
  private lastSuccessMs: number;

  constructor(
    private readonly intervalMs: number = IMPORT_HEARTBEAT_INTERVAL_MS,
    private readonly nowFn: () => number = () => Date.now(),
  ) {
    this.lastSuccessMs = this.nowFn();
  }

  public async maybeBeat(
    runId: string | null,
    trackingService: Pick<PipelineTrackingService, 'heartbeat'>,
  ): Promise<HeartbeatAttemptOutcome> {
    if (!runId) {
      return 'skipped';
    }

    const nowMs = this.nowFn();
    if (nowMs - this.lastSuccessMs < this.intervalMs) {
      return 'skipped';
    }

    try {
      const updated = await trackingService.heartbeat(runId);
      if (updated) {
        this.lastSuccessMs = this.nowFn();
        return 'sent';
      }
      return 'failed';
    } catch {
      return 'failed';
    }
  }
}

@Injectable()
export class PipelineTrackingService {
  private readonly logger = new Logger(PipelineTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  public async startRun(input: StartRunInput): Promise<string | null> {
    const pipelineName = this.normalizePipelineName(input.pipelineName);
    if (!pipelineName) {
      this.logger.warn('Rejected startRun call with invalid pipeline name.');
      return null;
    }

    const sanitizedMeta = this.sanitizeMetadata(input.metadata);
    const metadataJson = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null;

    try {
      const rows = await this.prisma.$queryRaw<CreatedRunRow[]>`
        INSERT INTO "pipeline_runs" (
          "pipeline_name",
          "trigger_type",
          "status",
          "started_at",
          "heartbeat_at",
          "updated_at",
          "metadata"
        )
        VALUES (
          ${pipelineName},
          ${input.triggerType}::"PipelineTriggerType",
          'RUNNING'::"PipelineRunStatus",
          clock_timestamp(),
          clock_timestamp(),
          clock_timestamp(),
          ${metadataJson}::jsonb
        )
        RETURNING "id"::text AS "id"
      `;

      const createdId = Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
      if (!createdId) {
        this.logger.error(`startRun for pipeline "${pipelineName}" returned no row ID.`);
        return null;
      }

      return createdId;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to start pipeline run for "${pipelineName}": ${this.describeSafeInternalError(error)}`,
      );
      return null;
    }
  }

  public async completeRun(runId: string | null, input: CompleteRunInput = {}): Promise<void> {
    if (!runId || !isUUID(runId, '4')) {
      if (runId !== null) {
        this.logger.warn('Ignored completeRun call with invalid runId UUID.');
      }
      return;
    }

    const counters = this.normalizeCounters(input);
    const status: PipelineRunStatus =
      input.status ??
      (counters.recordsRejected > 0
        ? PipelineRunStatus.PARTIAL_SUCCESS
        : PipelineRunStatus.SUCCEEDED);

    if (status !== PipelineRunStatus.SUCCEEDED && status !== PipelineRunStatus.PARTIAL_SUCCESS) {
      this.logger.warn(`Invalid terminal status "${String(status)}" supplied to completeRun.`);
      return;
    }

    const sanitizedMeta = this.sanitizeMetadata(input.metadata);
    const metadataJson = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null;

    try {
      const affected = await this.prisma.$executeRaw`
        UPDATE "pipeline_runs"
        SET
          "status" = ${status}::"PipelineRunStatus",
          "completed_at" = clock_timestamp(),
          "updated_at" = clock_timestamp(),
          "records_read" = ${counters.recordsRead},
          "records_inserted" = ${counters.recordsInserted},
          "records_updated" = ${counters.recordsUpdated},
          "records_skipped" = ${counters.recordsSkipped},
          "records_rejected" = ${counters.recordsRejected},
          "metadata" = CASE
            WHEN ${metadataJson}::jsonb IS NULL THEN "metadata"
            WHEN octet_length((COALESCE("metadata", '{}'::jsonb) || ${metadataJson}::jsonb)::text) <= ${MAX_METADATA_BYTES}
              THEN COALESCE("metadata", '{}'::jsonb) || ${metadataJson}::jsonb
            ELSE ${metadataJson}::jsonb
          END
        WHERE "id" = ${runId}::uuid
          AND "status" = 'RUNNING'::"PipelineRunStatus"
      `;

      if (affected === 0) {
        this.logger.warn(
          `Skipped completeRun for run ${runId}: record not found or already finalized.`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to complete pipeline run ${runId}: ${this.describeSafeInternalError(error)}`,
      );
    }
  }

  public async failRun(runId: string | null, input: FailRunInput): Promise<void> {
    if (!runId || !isUUID(runId, '4')) {
      if (runId !== null) {
        this.logger.warn('Ignored failRun call with invalid runId UUID.');
      }
      return;
    }

    const counters = this.normalizeCounters(input);
    const errorCode = this.normalizeErrorCode(input.errorCode);
    const errorSummary = this.resolveSafeErrorSummary(errorCode, input.errorSummary);
    const sanitizedMeta = this.sanitizeMetadata(input.metadata);
    const metadataJson = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null;

    try {
      const affected = await this.prisma.$executeRaw`
        UPDATE "pipeline_runs"
        SET
          "status" = 'FAILED'::"PipelineRunStatus",
          "completed_at" = clock_timestamp(),
          "updated_at" = clock_timestamp(),
          "records_read" = ${counters.recordsRead},
          "records_inserted" = ${counters.recordsInserted},
          "records_updated" = ${counters.recordsUpdated},
          "records_skipped" = ${counters.recordsSkipped},
          "records_rejected" = ${counters.recordsRejected},
          "error_code" = ${errorCode},
          "error_summary" = ${errorSummary},
          "metadata" = CASE
            WHEN ${metadataJson}::jsonb IS NULL THEN "metadata"
            WHEN octet_length((COALESCE("metadata", '{}'::jsonb) || ${metadataJson}::jsonb)::text) <= ${MAX_METADATA_BYTES}
              THEN COALESCE("metadata", '{}'::jsonb) || ${metadataJson}::jsonb
            ELSE ${metadataJson}::jsonb
          END
        WHERE "id" = ${runId}::uuid
          AND "status" = 'RUNNING'::"PipelineRunStatus"
      `;

      if (affected === 0) {
        this.logger.warn(
          `Skipped failRun for run ${runId}: record not found or already finalized.`,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to record failure for pipeline run ${runId}: ${this.describeSafeInternalError(error)}`,
      );
    }
  }

  public async heartbeat(runId: string | null): Promise<boolean> {
    if (!runId || !isUUID(runId, '4')) {
      return false;
    }

    try {
      const affected = await this.prisma.$executeRaw`
        UPDATE "pipeline_runs"
        SET
          "heartbeat_at" = clock_timestamp(),
          "updated_at" = clock_timestamp()
        WHERE "id" = ${runId}::uuid
          AND "status" = 'RUNNING'::"PipelineRunStatus"
      `;

      return affected === 1;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to update heartbeat for pipeline run ${runId}: ${this.describeSafeInternalError(error)}`,
      );
      return false;
    }
  }

  public async reconcileStaleRuns(options: ReconcileStaleRunsOptions = {}): Promise<number> {
    const staleAfterMs =
      typeof options.staleAfterMs === 'number' &&
      Number.isFinite(options.staleAfterMs) &&
      options.staleAfterMs > 0
        ? Math.trunc(options.staleAfterMs)
        : DEFAULT_STALE_THRESHOLD_MS;

    const pipelineName =
      options.pipelineName !== undefined ? this.normalizePipelineName(options.pipelineName) : null;

    if (options.pipelineName !== undefined && !pipelineName) {
      this.logger.warn('Ignored reconcileStaleRuns call with invalid pipelineName filter.');
      return 0;
    }

    const timeoutSummary = SAFE_ERROR_SUMMARIES[PIPELINE_ERROR_CODES.STALE_EXECUTION_TIMEOUT];

    try {
      const affected = await this.prisma.$executeRaw`
        UPDATE "pipeline_runs"
        SET
          "status" = 'TIMED_OUT'::"PipelineRunStatus",
          "completed_at" = clock_timestamp(),
          "updated_at" = clock_timestamp(),
          "error_code" = ${PIPELINE_ERROR_CODES.STALE_EXECUTION_TIMEOUT},
          "error_summary" = ${timeoutSummary}
        WHERE "status" = 'RUNNING'::"PipelineRunStatus"
          AND COALESCE("heartbeat_at", "started_at") <
            clock_timestamp() - (${staleAfterMs}::bigint * INTERVAL '1 millisecond')
          AND (${pipelineName}::text IS NULL OR "pipeline_name" = ${pipelineName}::text)
      `;

      if (affected > 0) {
        this.logger.warn(`Reconciled ${affected} stale RUNNING pipeline run(s) to TIMED_OUT.`);
      }

      return affected;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to reconcile stale pipeline runs: ${this.describeSafeInternalError(error)}`,
      );
      return 0;
    }
  }

  public sanitizeMetadata(raw: Record<string, unknown> | undefined): PipelineMetadata | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const sanitized: PipelineMetadata = {};

    for (const [key, value] of Object.entries(raw)) {
      if (!ALLOWED_METADATA_KEY_SET.has(key)) {
        continue;
      }

      const allowedKey = key as AllowedMetadataKey;

      if (NUMERIC_METADATA_KEYS.has(allowedKey)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          sanitized[allowedKey] = Math.trunc(value);
        }
        continue;
      }

      if (STRING_METADATA_KEYS.has(allowedKey) && typeof value === 'string') {
        const trimmed = value.trim();
        if (
          SAFE_STRING_TOKEN_PATTERN.test(trimmed) &&
          !UNSAFE_TEXT_PATTERNS.some((pattern) => pattern.test(trimmed))
        ) {
          sanitized[allowedKey] = trimmed;
        }
      }
    }

    const keys = Object.keys(sanitized) as AllowedMetadataKey[];
    if (keys.length === 0) {
      return null;
    }

    while (
      Object.keys(sanitized).length > 0 &&
      Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > MAX_METADATA_BYTES
    ) {
      const lastKey = (Object.keys(sanitized) as AllowedMetadataKey[]).pop();
      if (lastKey) {
        delete sanitized[lastKey];
      }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  private normalizePipelineName(name: string): string | null {
    if (typeof name !== 'string') {
      return null;
    }
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PIPELINE_NAME_LENGTH) {
      return null;
    }
    return PIPELINE_NAME_PATTERN.test(trimmed) ? trimmed : null;
  }

  private normalizeCounters(counters: RunCounters): NormalizedRunCounters {
    return {
      recordsRead: this.clampCounter(counters.recordsRead, 'recordsRead'),
      recordsInserted: this.clampCounter(counters.recordsInserted, 'recordsInserted'),
      recordsUpdated: this.clampCounter(counters.recordsUpdated, 'recordsUpdated'),
      recordsSkipped: this.clampCounter(counters.recordsSkipped, 'recordsSkipped'),
      recordsRejected: this.clampCounter(counters.recordsRejected, 'recordsRejected'),
    };
  }

  private clampCounter(value: number | undefined, field: string): number {
    if (value === undefined) {
      return 0;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      this.logger.warn(`Clamped invalid pipeline counter "${field}" to 0.`);
      return 0;
    }
    return Math.trunc(value);
  }

  private normalizeErrorCode(errorCode: string): string {
    if (typeof errorCode !== 'string') {
      return PIPELINE_ERROR_CODES.UNEXPECTED_ERROR;
    }
    const normalized = errorCode.trim().toUpperCase().slice(0, MAX_ERROR_CODE_LENGTH);
    return ERROR_CODE_PATTERN.test(normalized) ? normalized : PIPELINE_ERROR_CODES.UNEXPECTED_ERROR;
  }

  private resolveSafeErrorSummary(errorCode: string, explicitSummary?: string): string {
    const mapped = SAFE_ERROR_SUMMARIES[errorCode];
    if (mapped) {
      return mapped.slice(0, MAX_ERROR_SUMMARY_LENGTH);
    }

    if (typeof explicitSummary === 'string') {
      const normalized = explicitSummary.replace(/\s+/g, ' ').trim();
      if (
        normalized.length > 0 &&
        normalized.length <= MAX_ERROR_SUMMARY_LENGTH &&
        SAFE_SUMMARY_PATTERN.test(normalized) &&
        !UNSAFE_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))
      ) {
        return normalized;
      }
    }

    return GENERIC_SAFE_ERROR_SUMMARY;
  }

  private describeSafeInternalError(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Z0-9_]+$/i.test(code)) {
        return `database error code ${code}`;
      }
    }
    if (error instanceof Error) {
      return error.name || 'Error';
    }
    return 'UnknownError';
  }
}

export { PipelineTriggerType };
