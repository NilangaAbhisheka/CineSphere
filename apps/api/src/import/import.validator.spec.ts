// ==============================================================================
// CineSphere — Import Validator Unit Tests
// Phase 4.4
// ==============================================================================

import {
  validateJsonImport,
  validateCsvImport,
  CSV_REQUIRED_HEADERS,
  isStrictIso8601DateTime,
} from './import.validator.js';

// ── JSON Validation Tests ─────────────────────────────────────────────────────

describe('validateJsonImport', () => {
  const validDocument = {
    version: '1.0',
    entries: [
      {
        tmdbId: 550,
        mediaType: 'MOVIE',
        status: 'COMPLETED',
        personalRating: 8.5,
        notes: 'Great film',
        viewingEvents: [{ watchedAt: '2023-01-15T20:00:00Z', rating: 8.5, notes: 'First watch' }],
      },
    ],
  };

  describe('root structure', () => {
    it('rejects non-object root', () => {
      const { errors } = validateJsonImport([]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('object');
    });

    it('rejects null root', () => {
      const { errors } = validateJsonImport(null);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects unsupported version', () => {
      const { errors } = validateJsonImport({ version: '2.0', entries: [] });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('version');
    });

    it('rejects missing entries array', () => {
      const { errors } = validateJsonImport({ version: '1.0', entries: 'not an array' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts empty entries array', () => {
      const { document, errors } = validateJsonImport({ version: '1.0', entries: [] });
      expect(errors).toHaveLength(0);
      expect(document).not.toBeNull();
      expect(document!.entries).toHaveLength(0);
    });

    it('accepts valid document', () => {
      const { document, errors } = validateJsonImport(validDocument);
      expect(errors).toHaveLength(0);
      expect(document).not.toBeNull();
    });
  });

  describe('entry validation', () => {
    const makeEntry = (overrides: Record<string, unknown> = {}) => ({
      version: '1.0',
      entries: [{ tmdbId: 550, mediaType: 'MOVIE', status: 'COMPLETED', ...overrides }],
    });

    it('rejects non-object entry', () => {
      const { errors } = validateJsonImport({ version: '1.0', entries: ['not an object'] });
      expect(errors[0].index).toBe(0);
    });

    it('rejects missing tmdbId', () => {
      const { errors } = validateJsonImport(makeEntry({ tmdbId: undefined }));
      expect(errors.some((e) => e.field === 'tmdbId')).toBe(true);
    });

    it('rejects negative tmdbId', () => {
      const { errors } = validateJsonImport(makeEntry({ tmdbId: -1 }));
      expect(errors.some((e) => e.field === 'tmdbId')).toBe(true);
    });

    it('rejects float tmdbId', () => {
      const { errors } = validateJsonImport(makeEntry({ tmdbId: 1.5 }));
      expect(errors.some((e) => e.field === 'tmdbId')).toBe(true);
    });

    it('rejects invalid mediaType', () => {
      const { errors } = validateJsonImport(makeEntry({ mediaType: 'ANIME' }));
      expect(errors.some((e) => e.field === 'mediaType')).toBe(true);
    });

    it('rejects invalid status', () => {
      const { errors } = validateJsonImport(makeEntry({ status: 'INVALID_STATUS' }));
      expect(errors.some((e) => e.field === 'status')).toBe(true);
    });

    it('accepts all valid statuses', () => {
      for (const status of ['PLAN_TO_WATCH', 'WATCHING', 'COMPLETED', 'DROPPED']) {
        const { errors } = validateJsonImport(makeEntry({ status }));
        expect(errors.filter((e) => e.field === 'status')).toHaveLength(0);
      }
    });

    it('rejects invalid personalRating (out of range)', () => {
      const { errors } = validateJsonImport(makeEntry({ personalRating: 11 }));
      expect(errors.some((e) => e.field === 'personalRating')).toBe(true);
    });

    it('rejects invalid personalRating (not half-step)', () => {
      const { errors } = validateJsonImport(makeEntry({ personalRating: 7.3 }));
      expect(errors.some((e) => e.field === 'personalRating')).toBe(true);
    });

    it('accepts valid half-step ratings', () => {
      for (const rating of [1.0, 5.0, 7.5, 10.0]) {
        const { errors } = validateJsonImport(makeEntry({ personalRating: rating }));
        expect(errors.filter((e) => e.field === 'personalRating')).toHaveLength(0);
      }
    });

    it('accepts null personalRating', () => {
      const { errors } = validateJsonImport(makeEntry({ personalRating: null }));
      expect(errors.filter((e) => e.field === 'personalRating')).toHaveLength(0);
    });

    it('rejects invalid createdAt', () => {
      const { errors } = validateJsonImport(makeEntry({ createdAt: 'not-a-date' }));
      expect(errors.some((e) => e.field === 'createdAt')).toBe(true);
    });

    it('accepts valid ISO createdAt', () => {
      const { errors } = validateJsonImport(makeEntry({ createdAt: '2023-01-15T10:00:00Z' }));
      expect(errors.filter((e) => e.field === 'createdAt')).toHaveLength(0);
    });
  });

  describe('duplicate detection', () => {
    it('detects duplicate (tmdbId + mediaType) within entries', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          { tmdbId: 550, mediaType: 'MOVIE', status: 'COMPLETED' },
          { tmdbId: 550, mediaType: 'MOVIE', status: 'PLAN_TO_WATCH' },
        ],
      });
      expect(errors.some((e) => e.message.toLowerCase().includes('duplicate'))).toBe(true);
      expect(errors.some((e) => e.index === 1)).toBe(true);
    });

    it('allows same tmdbId with different mediaType', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          { tmdbId: 550, mediaType: 'MOVIE', status: 'COMPLETED' },
          { tmdbId: 550, mediaType: 'TV', status: 'PLAN_TO_WATCH' },
        ],
      });
      expect(errors.filter((e) => e.message.toLowerCase().includes('duplicate'))).toHaveLength(0);
    });
  });

  describe('mediaType-specific field validation', () => {
    it('rejects viewingEvents on TV entries', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 1399,
            mediaType: 'TV',
            status: 'WATCHING',
            viewingEvents: [{ watchedAt: '2023-01-01T00:00:00Z' }],
          },
        ],
      });
      expect(errors.some((e) => e.field === 'viewingEvents')).toBe(true);
    });

    it('rejects episodeProgress on MOVIE entries', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            episodeProgress: [{ episodeTmdbId: 100 }],
          },
        ],
      });
      expect(errors.some((e) => e.field === 'episodeProgress')).toBe(true);
    });

    it('rejects seasonRatings on MOVIE entries', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            seasonRatings: [{ seasonTmdbId: 1, rating: 8.0 }],
          },
        ],
      });
      expect(errors.some((e) => e.field === 'seasonRatings')).toBe(true);
    });

    it('rejects invalid viewing event rating', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [{ watchedAt: '2023-01-01T20:00:00.000Z', rating: 11.0 }],
          },
        ],
      });
      expect(errors.some((e) => e.message.includes('viewingEvents[0].rating'))).toBe(true);
    });

    it('rejects missing watchedAt on viewing event', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [{ rating: 8.5 }],
          },
        ],
      });
      expect(errors.some((e) => e.field === 'viewingEvents[0].watchedAt')).toBe(true);
      expect(errors.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('rejects empty or malformed watchedAt on viewing event', () => {
      const emptyRes = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [{ watchedAt: '   ' }],
          },
        ],
      });
      expect(emptyRes.errors.some((e) => e.field === 'viewingEvents[0].watchedAt')).toBe(true);

      const invalidRes = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [{ watchedAt: 'not-a-timestamp' }],
          },
        ],
      });
      expect(invalidRes.errors.some((e) => e.field === 'viewingEvents[0].watchedAt')).toBe(true);
    });

    it('accepts valid ISO 8601 watchedAt on viewing event', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'COMPLETED',
            viewingEvents: [{ watchedAt: '2023-05-15T19:30:00.000Z', rating: 8.5 }],
          },
        ],
      });
      expect(errors.filter((e) => e.field?.includes('viewingEvents'))).toHaveLength(0);
    });

    it('rejects duplicate episode TMDB IDs within an entry', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 1399,
            mediaType: 'TV',
            status: 'WATCHING',
            episodeProgress: [{ episodeTmdbId: 1001 }, { episodeTmdbId: 1001 }],
          },
        ],
      });
      expect(errors.some((e) => e.message.includes('duplicated'))).toBe(true);
    });

    it('rejects duplicate season TMDB IDs within an entry', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 1399,
            mediaType: 'TV',
            status: 'COMPLETED',
            seasonRatings: [
              { seasonTmdbId: 2001, rating: 8.0 },
              { seasonTmdbId: 2001, rating: 9.0 },
            ],
          },
        ],
      });
      expect(errors.some((e) => e.message.includes('duplicated'))).toBe(true);
    });

    it('rejects invalid season rating value', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 1399,
            mediaType: 'TV',
            status: 'COMPLETED',
            seasonRatings: [{ seasonTmdbId: 2001, rating: 0.5 }],
          },
        ],
      });
      expect(errors.some((e) => e.message.includes('seasonRatings[0].rating'))).toBe(true);
    });

    it('rejects negative episodeTmdbId', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          {
            tmdbId: 1399,
            mediaType: 'TV',
            status: 'WATCHING',
            episodeProgress: [{ episodeTmdbId: -5 }],
          },
        ],
      });
      expect(errors.some((e) => e.message.includes('episodeTmdbId'))).toBe(true);
    });
  });

  describe('error aggregation', () => {
    it('collects multiple errors from multiple entries', () => {
      const { errors } = validateJsonImport({
        version: '1.0',
        entries: [
          { tmdbId: -1, mediaType: 'INVALID', status: 'INVALID', personalRating: 11 },
          { tmdbId: -2, mediaType: 'INVALID', status: 'INVALID' },
        ],
      });
      // Should have multiple errors from both entries
      expect(errors.length).toBeGreaterThanOrEqual(6);
      const entry0Errors = errors.filter((e) => e.index === 0);
      const entry1Errors = errors.filter((e) => e.index === 1);
      expect(entry0Errors.length).toBeGreaterThan(0);
      expect(entry1Errors.length).toBeGreaterThan(0);
    });
  });
});

// ── CSV Validation Tests ──────────────────────────────────────────────────────

describe('validateCsvImport', () => {
  const validCsv = `tmdb_id,media_type,status,personal_rating,notes,created_at
550,MOVIE,COMPLETED,8.5,Great film,2023-01-15T10:00:00Z
1399,TV,WATCHING,,Still watching,`;

  it('parses valid CSV correctly', () => {
    const { rows, errors } = validateCsvImport(validCsv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].tmdb_id).toBe('550');
    expect(rows[0].media_type).toBe('MOVIE');
    expect(rows[0].status).toBe('COMPLETED');
    expect(rows[0].personal_rating).toBe('8.5');
    expect(rows[1].tmdb_id).toBe('1399');
  });

  it('requires all CSV required headers', () => {
    for (const req of CSV_REQUIRED_HEADERS) {
      const headers = CSV_REQUIRED_HEADERS.filter((h) => h !== req).join(',');
      const csv = `${headers}\n550,MOVIE,COMPLETED`;
      const { errors } = validateCsvImport(csv);
      expect(errors.some((e) => e.field === req)).toBe(true);
    }
  });

  it('rejects unrecognized headers', () => {
    const csv = `tmdb_id,media_type,status,unknown_field\n550,MOVIE,COMPLETED,extra`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.message.includes('unknown_field'))).toBe(true);
  });

  it('rejects empty CSV', () => {
    const { errors } = validateCsvImport('');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('skips blank lines gracefully', () => {
    const csv = `tmdb_id,media_type,status\n550,MOVIE,COMPLETED\n\n\n1399,TV,WATCHING`;
    const { rows, errors } = validateCsvImport(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it('rejects non-integer tmdb_id', () => {
    const csv = `tmdb_id,media_type,status\nabc,MOVIE,COMPLETED`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.field === 'tmdb_id')).toBe(true);
  });

  it('rejects float tmdb_id', () => {
    const csv = `tmdb_id,media_type,status\n1.5,MOVIE,COMPLETED`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.field === 'tmdb_id')).toBe(true);
  });

  it('rejects negative tmdb_id', () => {
    const csv = `tmdb_id,media_type,status\n-1,MOVIE,COMPLETED`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.field === 'tmdb_id')).toBe(true);
  });

  it('rejects invalid media_type', () => {
    const csv = `tmdb_id,media_type,status\n550,ANIME,COMPLETED`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.field === 'media_type')).toBe(true);
  });

  it('rejects invalid status', () => {
    const csv = `tmdb_id,media_type,status\n550,MOVIE,INVALID`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.field === 'status')).toBe(true);
  });

  it('rejects personal_rating not a half-step', () => {
    const csv = `tmdb_id,media_type,status,personal_rating\n550,MOVIE,COMPLETED,7.3`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.field === 'personal_rating')).toBe(true);
  });

  it('accepts empty personal_rating (optional)', () => {
    const csv = `tmdb_id,media_type,status,personal_rating\n550,MOVIE,COMPLETED,`;
    const { errors } = validateCsvImport(csv);
    expect(errors.filter((e) => e.field === 'personal_rating')).toHaveLength(0);
  });

  it('rejects invalid created_at date', () => {
    const csv = `tmdb_id,media_type,status,created_at\n550,MOVIE,COMPLETED,not-a-date`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.field === 'created_at')).toBe(true);
  });

  it('detects duplicate tmdb_id + media_type combinations', () => {
    const csv = `tmdb_id,media_type,status\n550,MOVIE,COMPLETED\n550,MOVIE,PLAN_TO_WATCH`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.message.toLowerCase().includes('duplicate'))).toBe(true);
  });

  it('allows same tmdb_id with different media_type', () => {
    const csv = `tmdb_id,media_type,status\n550,MOVIE,COMPLETED\n550,TV,WATCHING`;
    const { errors } = validateCsvImport(csv);
    expect(errors.filter((e) => e.message.toLowerCase().includes('duplicate'))).toHaveLength(0);
  });

  it('rejects row with wrong column count', () => {
    const csv = `tmdb_id,media_type,status\n550,MOVIE`;
    const { errors } = validateCsvImport(csv);
    expect(errors.some((e) => e.message.includes('column count'))).toBe(true);
  });

  it('handles quoted fields with commas', () => {
    const csv = `tmdb_id,media_type,status,notes\n550,MOVIE,COMPLETED,"Great, really great"`;
    const { rows, errors } = validateCsvImport(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].notes).toBe('Great, really great');
  });

  it('handles escaped quotes in quoted fields', () => {
    const csv = `tmdb_id,media_type,status,notes\n550,MOVIE,COMPLETED,"He said ""wow"""`;
    const { rows, errors } = validateCsvImport(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].notes).toBe('He said "wow"');
  });

  it('handles quoted fields with embedded newlines and preserves accurate row numbers', () => {
    const csv = `tmdb_id,media_type,status,notes
550,MOVIE,COMPLETED,"Line 1 of notes
Line 2 of notes
Line 3 of notes"
1399,TV,INVALID,note for show`;
    const { rows, errors } = validateCsvImport(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe('Line 1 of notes\nLine 2 of notes\nLine 3 of notes');
    // Physical line 5 is where the second record begins because line 1 is header and record 1 spanned lines 2-4
    expect(
      errors.some((e) => e.index === 5 && e.message.includes('Row 5: "status" must be one of')),
    ).toBe(true);
  });

  it('handles CRLF row endings and embedded CRLF in quotes', () => {
    const csv =
      'tmdb_id,media_type,status,notes\r\n550,MOVIE,COMPLETED,"Multi\r\nline note"\r\n1399,TV,WATCHING,Single line\r\n';
    const { rows, errors } = validateCsvImport(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe('Multi\r\nline note');
    expect(rows[1].notes).toBe('Single line');
  });

  it('rejects malformed CSV with unclosed quotes', () => {
    const csv = `tmdb_id,media_type,status,notes\n550,MOVIE,COMPLETED,"Unclosed quote notes`;
    const { rows, errors } = validateCsvImport(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('CSV parse error');
    expect(errors[0].message.toLowerCase()).toContain('unclosed quote');
  });

  it('collects multiple errors across rows', () => {
    const csv = `tmdb_id,media_type,status\nabc,INVALID,BAD\nxyz,ALSO_INVALID,WRONG`;
    const { errors } = validateCsvImport(csv);
    expect(errors.length).toBeGreaterThanOrEqual(4); // at least 2 per row
  });

  it('correctly maps physical CSV line numbers across multiple multiline rows', () => {
    // Line 1: Header
    // Line 2-4: Row 1 (multiline notes)
    // Line 5: Row 2 (single line)
    // Line 6-7: Row 3 (multiline notes with invalid status)
    const csv = [
      'tmdb_id,media_type,status,notes',
      '550,MOVIE,COMPLETED,"Note line 1',
      'Note line 2',
      'Note line 3"',
      '680,MOVIE,PLAN_TO_WATCH,Clean single line note',
      '1399,TV,INVALID_STATUS,"TV note line 1',
      'TV note line 2"',
    ].join('\n');

    const { rows, errors } = validateCsvImport(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]._rowNumber).toBe(2);
    expect(rows[1]._rowNumber).toBe(5);
    expect(rows[2]._rowNumber).toBe(6);

    const statusError = errors.find((e) => e.field === 'status');
    expect(statusError).toBeDefined();
    expect(statusError?.index).toBe(6); // Physical line 6
    expect(statusError?.message).toContain('Row 6: "status" must be one of');
  });
});

// ── Strict ISO 8601 DateTime Helper Tests ─────────────────────────────────────

describe('isStrictIso8601DateTime', () => {
  it('accepts valid UTC timestamps with Z', () => {
    expect(isStrictIso8601DateTime('2024-01-15T20:00:00Z')).toBe(true);
    expect(isStrictIso8601DateTime('2024-01-15T20:00:00.000Z')).toBe(true);
    expect(isStrictIso8601DateTime('2024-12-31T23:59:59.999Z')).toBe(true);
  });

  it('accepts valid timestamps with positive and negative timezone offsets', () => {
    expect(isStrictIso8601DateTime('2024-01-15T20:00:00+05:30')).toBe(true);
    expect(isStrictIso8601DateTime('2024-01-15T20:00:00-08:00')).toBe(true);
    expect(isStrictIso8601DateTime('2024-06-01T00:00:00+00:00')).toBe(true);
  });

  it('accepts February 29 on leap years', () => {
    expect(isStrictIso8601DateTime('2024-02-29T12:00:00Z')).toBe(true);
    expect(isStrictIso8601DateTime('2000-02-29T12:00:00Z')).toBe(true);
  });

  it('rejects February 29 on non-leap years', () => {
    expect(isStrictIso8601DateTime('2023-02-29T12:00:00Z')).toBe(false);
    expect(isStrictIso8601DateTime('2100-02-29T12:00:00Z')).toBe(false); // 2100 is not leap year
  });

  it('rejects invalid days for 30-day months', () => {
    expect(isStrictIso8601DateTime('2024-04-31T12:00:00Z')).toBe(false); // April has 30 days
    expect(isStrictIso8601DateTime('2024-06-31T12:00:00Z')).toBe(false); // June has 30 days
    expect(isStrictIso8601DateTime('2024-09-31T12:00:00Z')).toBe(false); // September has 30 days
    expect(isStrictIso8601DateTime('2024-11-31T12:00:00Z')).toBe(false); // November has 30 days
  });

  it('rejects February 30 and 31', () => {
    expect(isStrictIso8601DateTime('2024-02-30T12:00:00Z')).toBe(false);
    expect(isStrictIso8601DateTime('2024-02-31T12:00:00Z')).toBe(false);
  });

  it('rejects date-only strings without time and timezone', () => {
    expect(isStrictIso8601DateTime('2024-01-01')).toBe(false);
    expect(isStrictIso8601DateTime('2023-12-31')).toBe(false);
  });

  it('rejects datetime strings missing explicit timezone designator', () => {
    expect(isStrictIso8601DateTime('2024-01-01T12:00:00')).toBe(false);
  });

  it('rejects invalid clock times', () => {
    expect(isStrictIso8601DateTime('2024-01-01T24:00:00Z')).toBe(false);
    expect(isStrictIso8601DateTime('2024-01-01T25:00:00Z')).toBe(false);
    expect(isStrictIso8601DateTime('2024-01-01T12:60:00Z')).toBe(false);
    expect(isStrictIso8601DateTime('2024-01-01T12:00:60Z')).toBe(false);
  });

  it('rejects non-ISO formats and non-string types', () => {
    expect(isStrictIso8601DateTime('01/15/2024')).toBe(false);
    expect(isStrictIso8601DateTime('15-01-2024 12:00:00')).toBe(false);
    expect(isStrictIso8601DateTime('January 15, 2024')).toBe(false);
    expect(isStrictIso8601DateTime(null)).toBe(false);
    expect(isStrictIso8601DateTime(undefined)).toBe(false);
    expect(isStrictIso8601DateTime(1234567890)).toBe(false);
    expect(isStrictIso8601DateTime({})).toBe(false);
    expect(isStrictIso8601DateTime('')).toBe(false);
  });
});
