import { PipelineRunStatus, PipelineTriggerType } from '@prisma/client';
import { ALLOWED_METADATA_KEYS } from './observability.constants.js';

export type AllowedMetadataKey = (typeof ALLOWED_METADATA_KEYS)[number];

export type PipelineMetadataValue = string | number;

export type PipelineMetadata = Partial<Record<AllowedMetadataKey, PipelineMetadataValue>>;

export interface RunCounters {
  recordsRead?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  recordsSkipped?: number;
  recordsRejected?: number;
}

export interface NormalizedRunCounters {
  recordsRead: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsRejected: number;
}

export interface StartRunInput {
  pipelineName: string;
  triggerType: PipelineTriggerType;
  metadata?: Record<string, unknown>;
}

export interface CompleteRunInput extends RunCounters {
  status?: Extract<PipelineRunStatus, 'SUCCEEDED' | 'PARTIAL_SUCCESS'>;
  metadata?: Record<string, unknown>;
}

export interface FailRunInput extends RunCounters {
  errorCode: string;
  errorSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface ReconcileStaleRunsOptions {
  pipelineName?: string;
  staleAfterMs?: number;
}

export type HeartbeatAttemptOutcome = 'sent' | 'skipped' | 'failed';
