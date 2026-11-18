'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { apiClient, ApiClientError } from '@/lib/api-client';

type ExportFormat = 'json' | 'csv';

export default function ExportPage() {
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
  }, []);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (exportingFormat !== null) return; // Prevent duplicate concurrent requests

      setExportingFormat(format);
      setSuccessMessage(null);
      setErrorMessage(null);

      try {
        const result =
          format === 'json' ? await apiClient.exportJsonBlob() : await apiClient.exportCsvBlob();

        triggerDownload(result.blob, result.filename);
        setSuccessMessage(
          `Successfully exported your library as ${format.toUpperCase()} (${result.filename}).`,
        );
      } catch (err: unknown) {
        if (err instanceof ApiClientError) {
          setErrorMessage(err.message || `Failed to export ${format.toUpperCase()} data.`);
        } else {
          const error = err as Error;
          setErrorMessage(
            error.message ||
              `An unexpected error occurred while exporting ${format.toUpperCase()}.`,
          );
        }
      } finally {
        setExportingFormat(null);
      }
    },
    [exportingFormat, triggerDownload],
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Navigation Breadcrumb / Back Link */}
        <div className="mb-6 flex items-center justify-between text-sm">
          <Link
            href="/library"
            className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 transition-colors font-medium"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back to My Library
          </Link>
          <Link
            href="/import"
            className="text-gray-400 hover:text-gray-200 transition-colors font-medium"
          >
            Import Data →
          </Link>
        </div>

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Export Library Data</h1>
          <p className="mt-2 text-gray-400">
            Download a portable backup of your personal movie and TV tracking data in JSON or CSV
            format.
          </p>
        </div>

        {/* Success Alert Banner */}
        {successMessage && (
          <div
            className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-5 mb-6 flex items-start justify-between"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 text-xl font-bold" aria-hidden="true">
                ✓
              </span>
              <p className="text-emerald-300 text-sm font-medium">{successMessage}</p>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-emerald-400/80 hover:text-emerald-200 text-xs font-semibold"
              aria-label="Dismiss success message"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Error Alert Banner */}
        {errorMessage && (
          <div
            data-testid="export-error-alert"
            className="rounded-xl border border-red-800 bg-red-950/40 p-5 mb-6"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-semibold text-red-400">Export Failed</h2>
                <p className="text-gray-300 text-sm mt-1">{errorMessage}</p>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400 hover:text-red-300 text-xs font-semibold"
                aria-label="Dismiss error message"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Export Format Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* JSON Full-Fidelity Card */}
          <div className="rounded-xl border border-sky-800 bg-sky-950/20 p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xl font-bold text-white">JSON</span>
                <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-sky-800 text-sky-200">
                  Recommended
                </span>
              </div>
              <p className="text-gray-300 text-sm mb-4 leading-relaxed">
                Full-fidelity backup format. Preserves your entire library, including movie viewing
                history and rewatches, TV episode watch progress (with watch timestamps), and
                per-season ratings.
              </p>
              <ul className="text-xs text-sky-300/80 space-y-1.5 mb-6 list-disc list-inside">
                <li>Compatible with CineSphere JSON Importer</li>
                <li>Movie rewatches and viewing notes</li>
                <li>TV episode-level progress and dates</li>
                <li>Per-season numeric ratings</li>
              </ul>
            </div>

            <button
              onClick={() => handleExport('json')}
              disabled={exportingFormat !== null}
              aria-busy={exportingFormat === 'json'}
              className="w-full py-3 px-5 rounded-lg font-semibold text-sm bg-sky-600 hover:bg-sky-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2 shadow-md shadow-sky-900/30"
            >
              {exportingFormat === 'json' ? (
                <>
                  <Spinner />
                  Exporting JSON…
                </>
              ) : (
                <>
                  <DownloadIcon />
                  Export as JSON
                </>
              )}
            </button>
          </div>

          {/* CSV Flat Representation Card */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xl font-bold text-white">CSV</span>
                <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-gray-800 text-gray-300">
                  Spreadsheet-Friendly
                </span>
              </div>
              <p className="text-gray-300 text-sm mb-3 leading-relaxed">
                Flat spreadsheet projection containing six core fields: TMDB ID, media type, status,
                personal rating, personal notes, and creation timestamp.
              </p>

              {/* Explicit Limitation Notice */}
              <div className="rounded-lg bg-amber-950/30 border border-amber-800/60 p-3.5 mb-6">
                <div className="text-amber-400 font-semibold text-xs mb-1">
                  Notice: Flat Format Limitations
                </div>
                <p className="text-amber-300/80 text-xs leading-relaxed">
                  CSV exports contain flat library records only (TMDB ID, media type, status,
                  rating, notes, and creation date). They do not include titles, movie viewing
                  history, episode progress, or season ratings. Use JSON for complete backups.
                </p>
              </div>
            </div>

            <button
              onClick={() => handleExport('csv')}
              disabled={exportingFormat !== null}
              aria-busy={exportingFormat === 'csv'}
              className="w-full py-3 px-5 rounded-lg font-semibold text-sm bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-gray-200 hover:text-white transition-colors flex items-center justify-center gap-2"
            >
              {exportingFormat === 'csv' ? (
                <>
                  <Spinner />
                  Exporting CSV…
                </>
              ) : (
                <>
                  <DownloadIcon />
                  Export as CSV
                </>
              )}
            </button>
          </div>
        </div>

        {/* Documentation Section */}
        <details className="border border-gray-800 rounded-xl">
          <summary className="p-5 cursor-pointer text-gray-300 font-medium select-none hover:text-white transition-colors">
            Data Portability & Format Details
          </summary>
          <div className="p-5 pt-0 space-y-4 text-sm text-gray-400">
            <p>
              CineSphere guarantees complete data ownership. All personal movie and television
              tracking data belongs entirely to you and can be exported at any time.
            </p>
            <section>
              <h3 className="text-white font-semibold text-sm mb-1">JSON Compatibility (v1.0)</h3>
              <p className="text-xs text-gray-400">
                The exported JSON file mirrors the exact schema used by the CineSphere Importer. You
                can import your exported JSON backup into any CineSphere instance without data loss.
              </p>
            </section>
            <section>
              <h3 className="text-white font-semibold text-sm mb-1">CSV RFC 4180 Specification</h3>
              <p className="text-xs text-gray-400">
                The CSV export contains exactly six columns:{' '}
                <code className="text-sky-300">tmdb_id</code>,{' '}
                <code className="text-sky-300">media_type</code>,{' '}
                <code className="text-sky-300">status</code>,{' '}
                <code className="text-sky-300">personal_rating</code>,{' '}
                <code className="text-sky-300">notes</code>, and{' '}
                <code className="text-sky-300">created_at</code>. Notes with commas, quotes, or
                newlines are safely escaped according to RFC 4180 standards.
              </p>
            </section>
            <section>
              <h3 className="text-white font-semibold text-sm mb-1">Privacy & Cache Control</h3>
              <p className="text-xs text-gray-400">
                Export responses are transmitted with strict{' '}
                <code className="text-sky-300">no-store</code> headers to ensure private viewing
                history and personal notes are never cached by intermediate proxies or browsers.
              </p>
            </section>
          </div>
        </details>
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
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
