'use client';

import React, { useCallback, useRef, useState } from 'react';
import { ImportResponse } from '@cinesphere/shared';
import { apiClient } from '@/lib/api-client';
import { ApiClientError } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportFormat = 'json' | 'csv';
type ImportState = 'idle' | 'loading' | 'success' | 'error';

// ── File format detection ─────────────────────────────────────────────────────

function detectFormat(file: File): ImportFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.csv')) return 'csv';
  // Fall back to MIME type
  if (file.type === 'application/json' || file.type === 'text/json') return 'json';
  if (file.type === 'text/csv' || file.type === 'application/csv') return 'csv';
  return null;
}

// ── Import Page ───────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<ImportFormat | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);

  const [importState, setImportState] = useState<ImportState>('idle');
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLoading = importState === 'loading';

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setImportResult(null);
    setErrorMessage(null);
    setImportState('idle');

    if (file) {
      const fmt = detectFormat(file);
      setDetectedFormat(fmt);
      if (!fmt) {
        setFormatError('Unsupported file type. Please upload a .json or .csv file.');
      } else {
        setFormatError(null);
      }
    } else {
      setDetectedFormat(null);
      setFormatError(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) {
      setSelectedFile(file);
      setImportResult(null);
      setErrorMessage(null);
      setImportState('idle');

      const fmt = detectFormat(file);
      setDetectedFormat(fmt);
      if (!fmt) {
        setFormatError('Unsupported file type. Please upload a .json or .csv file.');
      } else {
        setFormatError(null);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  // ── Import submission ───────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!selectedFile || !detectedFormat || isLoading) return;

    setImportState('loading');
    setImportResult(null);
    setErrorMessage(null);

    try {
      let result: ImportResponse;

      if (detectedFormat === 'json') {
        result = await apiClient.importJson(selectedFile);
      } else {
        result = await apiClient.importCsv(selectedFile);
      }

      setImportResult(result);
      setImportState(result.success ? 'success' : 'error');
    } catch (err: unknown) {
      setImportState('error');
      if (err instanceof ApiClientError) {
        // Try to extract structured validation errors from API response
        const body = err.responseBody as Record<string, unknown> | undefined;
        if (body && typeof body === 'object') {
          const result = body as unknown as ImportResponse;
          if (result.errors && Array.isArray(result.errors)) {
            setImportResult(result);
            return;
          }
        }
        setErrorMessage(err.message || 'Import failed due to an API error.');
      } else {
        const error = err as Error;
        setErrorMessage(error.message || 'An unexpected error occurred during import.');
      }
    }
  }, [selectedFile, detectedFormat, isLoading]);

  const handleReset = useCallback(() => {
    setSelectedFile(null);
    setDetectedFormat(null);
    setFormatError(null);
    setImportResult(null);
    setErrorMessage(null);
    setImportState('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const canImport = selectedFile !== null && detectedFormat !== null && !isLoading;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Import Library Data</h1>
          <p className="mt-2 text-gray-400">
            Import your personal movie and TV tracking data from a JSON or CSV file.
          </p>
        </div>

        {/* Format Guide */}
        <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormatCard
            format="JSON"
            recommended
            description="Full-fidelity import. Supports library entries, viewing history, episode progress, and season ratings."
            limitations={null}
          />
          <FormatCard
            format="CSV"
            recommended={false}
            description="Flat spreadsheet-friendly format. Supports library entries only."
            limitations="Viewing history, episode progress, and season ratings are not supported in CSV. Use JSON for complete backups."
          />
        </div>

        {/* File Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors mb-6 ${
            selectedFile
              ? detectedFormat
                ? 'border-sky-500 bg-sky-950/30'
                : 'border-red-500 bg-red-950/20'
              : 'border-gray-700 hover:border-gray-500 bg-gray-900'
          }`}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          aria-label="File drop area"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="hidden"
            onChange={handleFileChange}
            aria-label="File upload input"
          />

          {selectedFile ? (
            <div>
              <div className="text-4xl mb-3">
                {detectedFormat === 'json' ? '📄' : detectedFormat === 'csv' ? '📊' : '❓'}
              </div>
              <p className="font-semibold text-white text-lg">{selectedFile.name}</p>
              <p className="text-gray-400 text-sm mt-1">
                {(selectedFile.size / 1024).toFixed(1)} KB
                {detectedFormat && (
                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium uppercase bg-sky-900 text-sky-300">
                    {detectedFormat}
                  </span>
                )}
              </p>
              {formatError && <p className="mt-3 text-red-400 text-sm">{formatError}</p>}
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-3">📁</div>
              <p className="text-gray-300 font-medium">Drop your file here, or click to browse</p>
              <p className="text-gray-500 text-sm mt-1">Supports .json and .csv files</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-8">
          <button
            onClick={handleImport}
            disabled={!canImport}
            aria-busy={isLoading}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold text-sm transition-colors ${
              canImport
                ? 'bg-sky-600 hover:bg-sky-500 text-white'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                Importing…
              </span>
            ) : (
              'Import File'
            )}
          </button>
          {(selectedFile || importResult) && (
            <button
              onClick={handleReset}
              disabled={isLoading}
              className="py-3 px-5 rounded-lg font-semibold text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        {/* Result Display */}
        {importState === 'success' && importResult && importResult.success && (
          <SuccessResult result={importResult} />
        )}

        {importState === 'error' && (
          <>
            {importResult && importResult.errors.length > 0 ? (
              <ValidationErrors result={importResult} />
            ) : (
              <div
                className="rounded-xl border border-red-800 bg-red-950/30 p-6"
                role="alert"
                aria-live="assertive"
              >
                <h2 className="text-lg font-semibold text-red-400 mb-2">Import Failed</h2>
                <p className="text-gray-300 text-sm">
                  {errorMessage || 'An unexpected error occurred.'}
                </p>
              </div>
            )}
          </>
        )}

        {/* Documentation */}
        <ImportDocumentation />
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormatCard({
  format,
  recommended,
  description,
  limitations,
}: {
  format: string;
  recommended: boolean;
  description: string;
  limitations: string | null;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        recommended ? 'border-sky-700 bg-sky-950/20' : 'border-gray-700 bg-gray-900'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="font-bold text-white">{format}</span>
        {recommended && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-sky-800 text-sky-200">
            Recommended
          </span>
        )}
      </div>
      <p className="text-gray-300 text-sm mb-2">{description}</p>
      {limitations && <p className="text-amber-400/80 text-xs">{limitations}</p>}
    </div>
  );
}

function SuccessResult({ result }: { result: ImportResponse }) {
  return (
    <div
      className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-6 mb-8"
      role="status"
      aria-live="polite"
    >
      <h2 className="text-lg font-semibold text-emerald-400 mb-3">✓ Import Complete</h2>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatBadge label="Total" value={result.total} />
        <StatBadge label="Imported" value={result.imported} highlight />
        <StatBadge label="Skipped" value={result.skipped} />
      </div>
      <p className="text-gray-300 text-sm">{result.summary}</p>
      {result.skipped > 0 && (
        <p className="text-gray-400 text-xs mt-2">
          Skipped entries already existed in your library and were not overwritten.
        </p>
      )}
      <div className="mt-5">
        <a
          href="/library"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors"
        >
          View My Library
        </a>
      </div>
    </div>
  );
}

function ValidationErrors({ result }: { result: ImportResponse }) {
  return (
    <div
      className="rounded-xl border border-red-800 bg-red-950/30 p-6 mb-8"
      role="alert"
      aria-live="assertive"
    >
      <h2 className="text-lg font-semibold text-red-400 mb-1">Import Failed — Validation Errors</h2>
      <p className="text-gray-400 text-sm mb-4">{result.summary}</p>
      <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {result.errors.map((err, i) => (
          <li key={i} className="rounded-lg bg-red-900/30 border border-red-800/50 p-3 text-sm">
            <span className="text-red-300 font-medium mr-2">
              {err.index >= 0 ? `Entry #${err.index + 1}` : 'File'}
            </span>
            {err.field && (
              <span className="text-red-400 font-mono text-xs mr-2">[{err.field}]</span>
            )}
            <span className="text-gray-300">{err.message}</span>
          </li>
        ))}
      </ul>
      <p className="text-gray-500 text-xs mt-4">
        No personal tracking records were written. Fix the errors in your file and try again.
      </p>
    </div>
  );
}

function StatBadge({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg bg-gray-900 p-3 text-center">
      <div className={`text-2xl font-bold ${highlight ? 'text-emerald-400' : 'text-white'}`}>
        {value}
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function ImportDocumentation() {
  return (
    <details className="border border-gray-800 rounded-xl mt-8">
      <summary className="p-5 cursor-pointer text-gray-300 font-medium select-none hover:text-white transition-colors">
        Import Format Reference
      </summary>
      <div className="p-5 pt-0 space-y-6 text-sm text-gray-400">
        <section>
          <h3 className="text-white font-semibold mb-2">JSON Format (v1.0)</h3>
          <p className="mb-2">
            JSON is the recommended format for complete backups. It preserves all tracking data
            including viewing history, episode progress, and season ratings.
          </p>
          <pre className="bg-gray-900 rounded-lg p-4 text-xs overflow-x-auto text-gray-300">
            {`{
  "version": "1.0",
  "entries": [
    {
      "tmdbId": 550,
      "mediaType": "MOVIE",
      "status": "COMPLETED",
      "personalRating": 8.5,
      "notes": "One of my favourites",
      "viewingEvents": [
        { "watchedAt": "2023-01-15T20:00:00Z", "rating": 8.5 }
      ]
    },
    {
      "tmdbId": 1399,
      "mediaType": "TV",
      "status": "COMPLETED",
      "episodeProgress": [
        { "episodeTmdbId": 63056, "watchedAt": "2023-01-01T20:00:00Z" }
      ],
      "seasonRatings": [
        { "seasonTmdbId": 3624, "rating": 9.0 }
      ]
    }
  ]
}`}
          </pre>
        </section>

        <section>
          <h3 className="text-white font-semibold mb-2">CSV Format</h3>
          <p className="mb-2">
            CSV supports flat library entries only. Nested data (viewing history, episode progress,
            season ratings) are not supported — use JSON for those.
          </p>
          <p className="mb-2">
            <strong className="text-gray-300">Required columns:</strong>{' '}
            <code className="text-sky-400">tmdb_id</code>,{' '}
            <code className="text-sky-400">media_type</code>,{' '}
            <code className="text-sky-400">status</code>
          </p>
          <p className="mb-2">
            <strong className="text-gray-300">Optional columns:</strong>{' '}
            <code className="text-sky-400">personal_rating</code>,{' '}
            <code className="text-sky-400">notes</code>,{' '}
            <code className="text-sky-400">created_at</code>
          </p>
          <pre className="bg-gray-900 rounded-lg p-4 text-xs overflow-x-auto text-gray-300">
            {`tmdb_id,media_type,status,personal_rating,notes,created_at
550,MOVIE,COMPLETED,8.5,Great film,2023-01-15T10:00:00Z
1399,TV,WATCHING,,Still watching,`}
          </pre>
        </section>

        <section>
          <h3 className="text-white font-semibold mb-2">Status Values</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <code className="text-sky-400">PLAN_TO_WATCH</code> — Added to watch later list
            </li>
            <li>
              <code className="text-sky-400">WATCHING</code> — Currently watching
            </li>
            <li>
              <code className="text-sky-400">COMPLETED</code> — Finished
            </li>
            <li>
              <code className="text-sky-400">DROPPED</code> — Stopped watching
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-white font-semibold mb-2">Duplicate & Conflict Behaviour</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>
              Entries that already exist in your library are{' '}
              <strong className="text-gray-300">skipped</strong>, not overwritten.
            </li>
            <li>
              Duplicate entries within the same import file are rejected as a validation error.
            </li>
            <li>
              Failed imports roll back all changes — your existing data is never partially modified.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-white font-semibold mb-2">File Size Limits</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>JSON: 5 MB maximum</li>
            <li>CSV: 2 MB maximum</li>
          </ul>
        </section>
      </div>
    </details>
  );
}
