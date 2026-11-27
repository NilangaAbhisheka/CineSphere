export const PIPELINE_NAMES = {
  IMPORT_JSON: 'import_json',
  IMPORT_CSV: 'import_csv',
} as const;

export const PIPELINE_ERROR_CODES = {
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  MALFORMED_JSON: 'MALFORMED_JSON',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  REFERENCE_RESOLUTION_FAILED: 'REFERENCE_RESOLUTION_FAILED',
  REFERENCE_VALIDATION_FAILED: 'REFERENCE_VALIDATION_FAILED',
  PERSISTENCE_ERROR: 'PERSISTENCE_ERROR',
  STALE_EXECUTION_TIMEOUT: 'STALE_EXECUTION_TIMEOUT',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
} as const;

export const DEFAULT_STALE_THRESHOLD_MS = 15 * 60 * 1000;
export const IMPORT_HEARTBEAT_INTERVAL_MS = 60 * 1000;

export const MAX_PIPELINE_NAME_LENGTH = 80;
export const MAX_ERROR_CODE_LENGTH = 80;
export const MAX_ERROR_SUMMARY_LENGTH = 1000;
export const MAX_METADATA_BYTES = 8192;

export const ALLOWED_METADATA_KEYS = [
  'format',
  'fileSizeBytes',
  'failurePhase',
  'validationErrorCount',
  'modelName',
  'modelRevision',
  'dimensions',
  'device',
  'batchSize',
  'batchesSucceeded',
  'batchesFailed',
  'pagesProcessed',
  'partialTvCount',
  'leaseName',
  'fencingToken',
] as const;

export const SAFE_ERROR_SUMMARIES: Readonly<Record<string, string>> = {
  [PIPELINE_ERROR_CODES.PAYLOAD_TOO_LARGE]:
    'Import payload exceeded the maximum allowed file size.',
  [PIPELINE_ERROR_CODES.MALFORMED_JSON]: 'Import payload contained malformed JSON syntax.',
  [PIPELINE_ERROR_CODES.VALIDATION_FAILED]:
    'Import payload failed structural or schema validation.',
  [PIPELINE_ERROR_CODES.REFERENCE_RESOLUTION_FAILED]:
    'Import failed while resolving catalogue media references.',
  [PIPELINE_ERROR_CODES.REFERENCE_VALIDATION_FAILED]:
    'Import failed while validating TV season or episode catalogue references.',
  [PIPELINE_ERROR_CODES.PERSISTENCE_ERROR]:
    'Database transaction failed during import persistence; all personal tracking changes were rolled back.',
  [PIPELINE_ERROR_CODES.STALE_EXECUTION_TIMEOUT]:
    'Execution marked TIMED_OUT after exceeding the stale heartbeat threshold.',
  [PIPELINE_ERROR_CODES.UNEXPECTED_ERROR]: 'An unexpected operational pipeline error occurred.',
};

export const GENERIC_SAFE_ERROR_SUMMARY = 'An operational pipeline error occurred.';
