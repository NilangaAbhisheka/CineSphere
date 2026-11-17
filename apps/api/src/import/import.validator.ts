// ==============================================================================
// CineSphere — Import Validator
// Phase 4.4: Validates JSON and CSV import payloads before database writes.
// All errors are collected and returned together — never silently skipped.
// ==============================================================================

import {
  ImportDocument,
  ImportEntry,
  ImportEpisodeProgress,
  ImportSeasonRating,
  ImportValidationError,
  ImportViewingEvent,
  CsvImportRow,
} from '@cinesphere/shared';

const VALID_STATUSES = new Set(['PLAN_TO_WATCH', 'WATCHING', 'COMPLETED', 'DROPPED']);
const VALID_MEDIA_TYPES = new Set(['MOVIE', 'TV']);

function isValidRating(r: unknown): boolean {
  if (r === null || r === undefined) return true;
  if (typeof r !== 'number') return false;
  if (!isFinite(r)) return false;
  if (r < 1.0 || r > 10.0) return false;
  // Must be a half-step multiple (1.0, 1.5, 2.0, ... 10.0)
  return Math.round(r * 2) / 2 === r;
}

const ISO_8601_DATETIME_REGEX =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

export function isStrictIso8601DateTime(d: unknown): boolean {
  if (typeof d !== 'string') return false;
  const match = ISO_8601_DATETIME_REGEX.exec(d);
  if (!match) return false;

  const year = parseInt(d.substring(0, 4), 10);
  const month = parseInt(d.substring(5, 7), 10);
  const day = parseInt(d.substring(8, 10), 10);

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [0, 31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (day > daysInMonth[month]) {
    return false;
  }

  const ts = Date.parse(d);
  return !isNaN(ts);
}

function isValidOptionalDateTimeString(d: unknown): boolean {
  if (d === null || d === undefined) return true;
  if (typeof d !== 'string' || d.trim() === '') return true; // optional
  return isStrictIso8601DateTime(d);
}

function isRequiredDateTimeString(d: unknown): boolean {
  if (d === null || d === undefined || typeof d !== 'string' || d.trim() === '') return false;
  return isStrictIso8601DateTime(d);
}

function pushError(
  errors: ImportValidationError[],
  index: number,
  message: string,
  field?: string,
): void {
  errors.push({ index, field, message });
}

// ── JSON Validation ───────────────────────────────────────────────────────────

export function validateJsonImport(raw: unknown): {
  document: ImportDocument | null;
  errors: ImportValidationError[];
} {
  const errors: ImportValidationError[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      document: null,
      errors: [{ index: -1, message: 'JSON root must be an object.' }],
    };
  }

  const doc = raw as Record<string, unknown>;

  // version check
  if (doc['version'] !== '1.0') {
    errors.push({
      index: -1,
      field: 'version',
      message: `Unsupported import version: "${String(doc['version'])}". Expected "1.0".`,
    });
    return { document: null, errors };
  }

  if (!Array.isArray(doc['entries'])) {
    errors.push({ index: -1, field: 'entries', message: '"entries" must be an array.' });
    return { document: null, errors };
  }

  const entries = doc['entries'] as unknown[];

  // Track duplicate (tmdbId + mediaType) pairs within the file
  const seenEntries = new Map<string, number>();

  for (let i = 0; i < entries.length; i++) {
    validateJsonEntry(entries[i], i, errors, seenEntries);
  }

  if (errors.length > 0) {
    return { document: null, errors };
  }

  return { document: doc as unknown as ImportDocument, errors: [] };
}

function validateJsonEntry(
  raw: unknown,
  index: number,
  errors: ImportValidationError[],
  seenEntries: Map<string, number>,
): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    pushError(errors, index, 'Entry must be an object.');
    return;
  }

  const entry = raw as Record<string, unknown>;

  // tmdbId
  if (
    typeof entry['tmdbId'] !== 'number' ||
    !Number.isInteger(entry['tmdbId']) ||
    entry['tmdbId'] <= 0
  ) {
    pushError(errors, index, '"tmdbId" must be a positive integer.', 'tmdbId');
  }

  // mediaType
  if (
    typeof entry['mediaType'] !== 'string' ||
    !VALID_MEDIA_TYPES.has(entry['mediaType'] as string)
  ) {
    pushError(
      errors,
      index,
      `"mediaType" must be one of: ${[...VALID_MEDIA_TYPES].join(', ')}.`,
      'mediaType',
    );
  }

  // status
  if (typeof entry['status'] !== 'string' || !VALID_STATUSES.has(entry['status'] as string)) {
    pushError(
      errors,
      index,
      `"status" must be one of: ${[...VALID_STATUSES].join(', ')}.`,
      'status',
    );
  }

  // personalRating (optional)
  if (entry['personalRating'] !== undefined && entry['personalRating'] !== null) {
    if (!isValidRating(entry['personalRating'])) {
      pushError(
        errors,
        index,
        '"personalRating" must be between 1.0 and 10.0 in half-step increments (e.g., 7.0, 7.5).',
        'personalRating',
      );
    }
  }

  // notes (optional)
  if (
    entry['notes'] !== undefined &&
    entry['notes'] !== null &&
    typeof entry['notes'] !== 'string'
  ) {
    pushError(errors, index, '"notes" must be a string.', 'notes');
  }

  // createdAt (optional)
  if (entry['createdAt'] !== undefined && !isValidOptionalDateTimeString(entry['createdAt'])) {
    pushError(
      errors,
      index,
      '"createdAt" must be a valid ISO 8601 datetime string with timezone (e.g. YYYY-MM-DDTHH:mm:ssZ).',
      'createdAt',
    );
  }

  // Duplicate detection within file
  const tmdbId = typeof entry['tmdbId'] === 'number' ? entry['tmdbId'] : null;
  const mediaType = typeof entry['mediaType'] === 'string' ? entry['mediaType'] : null;
  if (tmdbId !== null && mediaType !== null) {
    const key = `${mediaType}:${tmdbId}`;
    if (seenEntries.has(key)) {
      pushError(
        errors,
        index,
        `Duplicate entry: ${mediaType} with tmdbId ${tmdbId} already appears at index ${seenEntries.get(key)}.`,
        'tmdbId',
      );
    } else {
      seenEntries.set(key, index);
    }
  }

  // mediaType-specific validation
  const isMovie = entry['mediaType'] === 'MOVIE';
  const isTV = entry['mediaType'] === 'TV';

  // viewingEvents — only valid for MOVIE
  if (entry['viewingEvents'] !== undefined) {
    if (!isMovie) {
      pushError(
        errors,
        index,
        '"viewingEvents" is only supported for MOVIE entries.',
        'viewingEvents',
      );
    } else if (!Array.isArray(entry['viewingEvents'])) {
      pushError(errors, index, '"viewingEvents" must be an array.', 'viewingEvents');
    } else {
      (entry['viewingEvents'] as unknown[]).forEach((ev, evIdx) => {
        validateViewingEvent(ev, index, evIdx, errors);
      });
    }
  }

  // episodeProgress — only valid for TV
  if (entry['episodeProgress'] !== undefined) {
    if (!isTV) {
      pushError(
        errors,
        index,
        '"episodeProgress" is only supported for TV entries.',
        'episodeProgress',
      );
    } else if (!Array.isArray(entry['episodeProgress'])) {
      pushError(errors, index, '"episodeProgress" must be an array.', 'episodeProgress');
    } else {
      const seenEpisodes = new Set<number>();
      (entry['episodeProgress'] as unknown[]).forEach((ep, epIdx) => {
        validateEpisodeProgress(ep, index, epIdx, errors, seenEpisodes);
      });
    }
  }

  // seasonRatings — only valid for TV
  if (entry['seasonRatings'] !== undefined) {
    if (!isTV) {
      pushError(
        errors,
        index,
        '"seasonRatings" is only supported for TV entries.',
        'seasonRatings',
      );
    } else if (!Array.isArray(entry['seasonRatings'])) {
      pushError(errors, index, '"seasonRatings" must be an array.', 'seasonRatings');
    } else {
      const seenSeasons = new Set<number>();
      (entry['seasonRatings'] as unknown[]).forEach((sr, srIdx) => {
        validateSeasonRating(sr, index, srIdx, errors, seenSeasons);
      });
    }
  }
}

function validateViewingEvent(
  raw: unknown,
  entryIndex: number,
  eventIndex: number,
  errors: ImportValidationError[],
): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    pushError(
      errors,
      entryIndex,
      `viewingEvents[${eventIndex}] must be an object.`,
      `viewingEvents[${eventIndex}]`,
    );
    return;
  }

  const ev = raw as Record<string, unknown>;

  // watchedAt is REQUIRED for viewing events
  if (!isRequiredDateTimeString(ev['watchedAt'])) {
    pushError(
      errors,
      entryIndex,
      `viewingEvents[${eventIndex}].watchedAt is required and must be a valid ISO 8601 datetime string with timezone (e.g. YYYY-MM-DDTHH:mm:ssZ).`,
      `viewingEvents[${eventIndex}].watchedAt`,
    );
  }

  if (ev['rating'] !== undefined && ev['rating'] !== null && !isValidRating(ev['rating'])) {
    pushError(
      errors,
      entryIndex,
      `viewingEvents[${eventIndex}].rating must be between 1.0 and 10.0 in half-step increments.`,
      `viewingEvents[${eventIndex}].rating`,
    );
  }

  if (ev['notes'] !== undefined && ev['notes'] !== null && typeof ev['notes'] !== 'string') {
    pushError(
      errors,
      entryIndex,
      `viewingEvents[${eventIndex}].notes must be a string.`,
      `viewingEvents[${eventIndex}].notes`,
    );
  }
}

function validateEpisodeProgress(
  raw: unknown,
  entryIndex: number,
  epIndex: number,
  errors: ImportValidationError[],
  seenEpisodes: Set<number>,
): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    pushError(
      errors,
      entryIndex,
      `episodeProgress[${epIndex}] must be an object.`,
      `episodeProgress[${epIndex}]`,
    );
    return;
  }

  const ep = raw as Record<string, unknown>;

  if (
    typeof ep['episodeTmdbId'] !== 'number' ||
    !Number.isInteger(ep['episodeTmdbId']) ||
    (ep['episodeTmdbId'] as number) <= 0
  ) {
    pushError(
      errors,
      entryIndex,
      `episodeProgress[${epIndex}].episodeTmdbId must be a positive integer.`,
      `episodeProgress[${epIndex}].episodeTmdbId`,
    );
  } else {
    const episodeTmdbId = ep['episodeTmdbId'] as number;
    if (seenEpisodes.has(episodeTmdbId)) {
      pushError(
        errors,
        entryIndex,
        `episodeProgress[${epIndex}].episodeTmdbId ${episodeTmdbId} is duplicated within this entry.`,
        `episodeProgress[${epIndex}].episodeTmdbId`,
      );
    } else {
      seenEpisodes.add(episodeTmdbId);
    }
  }

  if (ep['watchedAt'] !== undefined && !isValidOptionalDateTimeString(ep['watchedAt'])) {
    pushError(
      errors,
      entryIndex,
      `episodeProgress[${epIndex}].watchedAt must be a valid ISO 8601 datetime string with timezone (e.g. YYYY-MM-DDTHH:mm:ssZ).`,
      `episodeProgress[${epIndex}].watchedAt`,
    );
  }
}

function validateSeasonRating(
  raw: unknown,
  entryIndex: number,
  srIndex: number,
  errors: ImportValidationError[],
  seenSeasons: Set<number>,
): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    pushError(
      errors,
      entryIndex,
      `seasonRatings[${srIndex}] must be an object.`,
      `seasonRatings[${srIndex}]`,
    );
    return;
  }

  const sr = raw as Record<string, unknown>;

  if (
    typeof sr['seasonTmdbId'] !== 'number' ||
    !Number.isInteger(sr['seasonTmdbId']) ||
    (sr['seasonTmdbId'] as number) <= 0
  ) {
    pushError(
      errors,
      entryIndex,
      `seasonRatings[${srIndex}].seasonTmdbId must be a positive integer.`,
      `seasonRatings[${srIndex}].seasonTmdbId`,
    );
  } else {
    const seasonTmdbId = sr['seasonTmdbId'] as number;
    if (seenSeasons.has(seasonTmdbId)) {
      pushError(
        errors,
        entryIndex,
        `seasonRatings[${srIndex}].seasonTmdbId ${seasonTmdbId} is duplicated within this entry.`,
        `seasonRatings[${srIndex}].seasonTmdbId`,
      );
    } else {
      seenSeasons.add(seasonTmdbId);
    }
  }

  if (!isValidRating(sr['rating'])) {
    pushError(
      errors,
      entryIndex,
      `seasonRatings[${srIndex}].rating must be between 1.0 and 10.0 in half-step increments.`,
      `seasonRatings[${srIndex}].rating`,
    );
  }
}

// ── CSV Validation ────────────────────────────────────────────────────────────

export const CSV_REQUIRED_HEADERS = ['tmdb_id', 'media_type', 'status'];
export const CSV_OPTIONAL_HEADERS = ['personal_rating', 'notes', 'created_at'];
export const CSV_ALL_HEADERS = [...CSV_REQUIRED_HEADERS, ...CSV_OPTIONAL_HEADERS];

/**
 * Parse and validate a raw CSV string.
 * Returns parsed rows and all validation errors found.
 *
 * Uses a full RFC 4180 compliant parser that correctly handles:
 * - Quoted fields containing commas
 * - Escaped double quotes ("")
 * - Quoted fields containing embedded CRLF or LF newlines
 * - Standard CRLF and LF row endings
 */
export function validateCsvImport(csvText: string): {
  rows: CsvImportRow[];
  errors: ImportValidationError[];
} {
  const errors: ImportValidationError[] = [];

  // Parse all records with the RFC 4180 compliant parser
  let parsedRecords: { rowNumber: number; fields: string[] }[];
  try {
    parsedRecords = parseCsvRfc4180(csvText);
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return { rows: [], errors: [{ index: 0, message: `CSV parse error: ${msg}` }] };
  }

  if (parsedRecords.length === 0) {
    return { rows: [], errors: [{ index: 0, message: 'CSV file is empty.' }] };
  }

  // First record is the header row
  const headerRecord = parsedRecords[0];
  const headers = headerRecord.fields.map((h) => h.trim().toLowerCase());

  // Check required headers
  for (const req of CSV_REQUIRED_HEADERS) {
    if (!headers.includes(req)) {
      errors.push({ index: 0, field: req, message: `Missing required CSV column: "${req}".` });
    }
  }

  if (errors.length > 0) {
    return { rows: [], errors };
  }

  // Check for unrecognized headers
  for (const h of headers) {
    if (!CSV_ALL_HEADERS.includes(h)) {
      errors.push({
        index: 0,
        field: h,
        message: `Unrecognized CSV column: "${h}". Supported columns: ${CSV_ALL_HEADERS.join(', ')}.`,
      });
    }
  }

  const rows: CsvImportRow[] = [];
  const seenEntries = new Map<string, number>();

  for (let recordIdx = 1; recordIdx < parsedRecords.length; recordIdx++) {
    const record = parsedRecords[recordIdx];
    const csvRowNumber = record.rowNumber;
    const values = record.fields;

    if (values.length !== headers.length) {
      errors.push({
        index: csvRowNumber,
        message: `Row ${csvRowNumber}: column count ${values.length} does not match header count ${headers.length}.`,
      });
      continue;
    }

    // Build row object
    const rowObj: Record<string, unknown> = {
      _rowNumber: record.rowNumber,
    };
    headers.forEach((h, i) => {
      rowObj[h] = values[i] ?? '';
    });

    const row = rowObj as unknown as CsvImportRow;

    // Validate tmdb_id
    const tmdbIdRaw = row.tmdb_id?.trim();
    const tmdbId = parseInt(tmdbIdRaw, 10);
    if (!tmdbIdRaw || isNaN(tmdbId) || tmdbId <= 0 || String(tmdbId) !== tmdbIdRaw) {
      errors.push({
        index: csvRowNumber,
        field: 'tmdb_id',
        message: `Row ${csvRowNumber}: "tmdb_id" must be a positive integer (got: "${tmdbIdRaw}").`,
      });
    }

    // Validate media_type
    const mediaType = row.media_type?.trim().toUpperCase();
    if (!VALID_MEDIA_TYPES.has(mediaType)) {
      errors.push({
        index: csvRowNumber,
        field: 'media_type',
        message: `Row ${csvRowNumber}: "media_type" must be MOVIE or TV (got: "${row.media_type}").`,
      });
    }

    // Validate status
    const status = row.status?.trim().toUpperCase();
    if (!VALID_STATUSES.has(status)) {
      errors.push({
        index: csvRowNumber,
        field: 'status',
        message: `Row ${csvRowNumber}: "status" must be one of PLAN_TO_WATCH, WATCHING, COMPLETED, DROPPED (got: "${row.status}").`,
      });
    }

    // Validate personal_rating (optional)
    if (row.personal_rating !== undefined && row.personal_rating.trim() !== '') {
      const ratingVal = parseFloat(row.personal_rating);
      if (!isValidRating(ratingVal)) {
        errors.push({
          index: csvRowNumber,
          field: 'personal_rating',
          message: `Row ${csvRowNumber}: "personal_rating" must be between 1.0 and 10.0 in half-step increments (got: "${row.personal_rating}").`,
        });
      }
    }

    // Validate created_at (optional)
    if (row.created_at !== undefined && row.created_at.trim() !== '') {
      if (!isValidOptionalDateTimeString(row.created_at)) {
        errors.push({
          index: csvRowNumber,
          field: 'created_at',
          message: `Row ${csvRowNumber}: "created_at" must be a valid ISO 8601 datetime string with timezone (got: "${row.created_at}").`,
        });
      }
    }

    // Duplicate detection
    if (!isNaN(tmdbId) && VALID_MEDIA_TYPES.has(mediaType)) {
      const key = `${mediaType}:${tmdbId}`;
      if (seenEntries.has(key)) {
        errors.push({
          index: csvRowNumber,
          field: 'tmdb_id',
          message: `Row ${csvRowNumber}: duplicate entry — ${mediaType} with tmdb_id ${tmdbId} already appears at row ${seenEntries.get(key)}.`,
        });
      } else {
        seenEntries.set(key, csvRowNumber);
      }
    }

    rows.push(row);
  }

  return { rows, errors };
}

/**
 * RFC 4180 compliant CSV parser.
 * Returns an array of records where each record contains:
 * - rowNumber: physical line number where the record began
 * - fields: the parsed string fields
 * Correctly handles:
 * - Quoted fields containing commas
 * - Escaped double quotes ("")
 * - Quoted fields containing CRLF or LF newlines
 * - Standard CRLF and LF row endings
 * - Blank line skipping
 * Throws a descriptive Error on malformed quoting (e.g. unclosed quote).
 */
export function parseCsvRfc4180(text: string): { rowNumber: number; fields: string[] }[] {
  const records: { rowNumber: number; fields: string[] }[] = [];
  let pos = 0;
  const len = text.length;
  let currentLine = 1;

  while (pos < len) {
    const recordStartLine = currentLine;
    const fields: string[] = [];

    // Parse one record
    while (true) {
      let field = '';

      if (pos < len && text[pos] === '"') {
        // Quoted field
        pos++; // consume opening quote
        while (true) {
          if (pos >= len) {
            throw new Error(`Unclosed quote in CSV starting near line ${recordStartLine}.`);
          }
          if (text[pos] === '"') {
            if (pos + 1 < len && text[pos + 1] === '"') {
              field += '"';
              pos += 2; // escaped quote ""
            } else {
              pos++; // closing quote
              break;
            }
          } else {
            if (text[pos] === '\r') {
              if (pos + 1 < len && text[pos + 1] === '\n') {
                field += '\r\n';
                pos += 2;
                currentLine++;
              } else {
                field += '\r';
                pos++;
                currentLine++;
              }
            } else if (text[pos] === '\n') {
              field += '\n';
              pos++;
              currentLine++;
            } else {
              field += text[pos];
              pos++;
            }
          }
        }

        // Consume any whitespace after closing quote until delimiter or newline/EOF
        while (pos < len && text[pos] !== ',' && text[pos] !== '\r' && text[pos] !== '\n') {
          if (text[pos] === ' ' || text[pos] === '\t') {
            pos++;
          } else {
            throw new Error(
              `Unexpected character '${text[pos]}' after closing quote near line ${recordStartLine}.`,
            );
          }
        }
      } else {
        // Unquoted field
        while (pos < len && text[pos] !== ',' && text[pos] !== '\r' && text[pos] !== '\n') {
          field += text[pos];
          pos++;
        }
      }

      fields.push(field);

      if (pos < len && text[pos] === ',') {
        pos++; // next field
      } else {
        break; // end of record
      }
    }

    // Consume line break at end of record
    if (pos < len) {
      if (text[pos] === '\r') {
        if (pos + 1 < len && text[pos + 1] === '\n') {
          pos += 2;
          currentLine++;
        } else {
          pos++;
          currentLine++;
        }
      } else if (text[pos] === '\n') {
        pos++;
        currentLine++;
      }
    }

    // Skip empty lines (a single empty field)
    if (fields.length === 1 && fields[0].trim() === '') {
      continue;
    }

    records.push({ rowNumber: recordStartLine, fields });
  }

  return records;
}

// ── Re-exports for type convenience ──────────────────────────────────────────

export type {
  ImportDocument,
  ImportEntry,
  ImportViewingEvent,
  ImportEpisodeProgress,
  ImportSeasonRating,
  CsvImportRow,
};
