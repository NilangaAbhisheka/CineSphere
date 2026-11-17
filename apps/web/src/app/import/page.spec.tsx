/**
 * import/page.spec.tsx
 *
 * Unit tests for the Import Page component.
 * apiClient.importJson and apiClient.importCsv are mocked.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportPage from './page';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { ImportResponse } from '@cinesphere/shared';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    importJson: jest.fn(),
    importCsv: jest.fn(),
  },
  ApiClientError: class extends Error {
    public readonly status: number;
    public readonly responseBody?: unknown;
    constructor(status: number, message: string, responseBody?: unknown) {
      super(message);
      this.name = 'ApiClientError';
      this.status = status;
      this.responseBody = responseBody;
    }
  },
}));

describe('ImportPage', () => {
  const mockImportJson = apiClient.importJson as jest.MockedFunction<typeof apiClient.importJson>;
  const mockImportCsv = apiClient.importCsv as jest.MockedFunction<typeof apiClient.importCsv>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders page header and format guide', () => {
    render(<ImportPage />);

    expect(screen.getByRole('heading', { name: /import library data/i })).toBeInTheDocument();
    expect(screen.getByText(/full-fidelity import/i)).toBeInTheDocument();
    expect(screen.getByText(/flat spreadsheet-friendly format/i)).toBeInTheDocument();
  });

  it('initially disables the import button when no file is selected', () => {
    render(<ImportPage />);

    const importButton = screen.getByRole('button', { name: 'Import File' });
    expect(importButton).toBeDisabled();
  });

  it('handles JSON file selection and displays detected format', () => {
    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['{"version":"1.0","entries":[]}'], 'backup.json', {
      type: 'application/json',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText('backup.json')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import file/i })).toBeEnabled();
  });

  it('handles CSV file selection and displays detected format', () => {
    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['tmdb_id,media_type,status\n550,MOVIE,COMPLETED'], 'movies.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText('movies.csv')).toBeInTheDocument();
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import file/i })).toBeEnabled();
  });

  it('shows error message and keeps import disabled for unsupported file types', () => {
    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['image data'], 'poster.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(
      screen.getByText(/unsupported file type\. please upload a \.json or \.csv file/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import File' })).toBeDisabled();
  });

  it('executes successful JSON import and displays success results', async () => {
    const successResponse: ImportResponse = {
      success: true,
      total: 3,
      imported: 2,
      skipped: 1,
      errors: [],
      summary: 'Imported 2 entries, skipped 1 already existing.',
    };
    mockImportJson.mockResolvedValue(successResponse);

    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['{"version":"1.0","entries":[]}'], 'data.json', {
      type: 'application/json',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const importButton = screen.getByRole('button', { name: 'Import File' });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Imported 2 entries, skipped 1 already existing.')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Imported count
    expect(screen.getByText('1')).toBeInTheDocument(); // Skipped count
  });

  it('executes successful CSV import and calls importCsv', async () => {
    const successResponse: ImportResponse = {
      success: true,
      total: 1,
      imported: 1,
      skipped: 0,
      errors: [],
      summary: 'Imported 1 entry.',
    };
    mockImportCsv.mockResolvedValue(successResponse);

    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['tmdb_id,media_type,status\n550,MOVIE,COMPLETED'], 'data.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const importButton = screen.getByRole('button', { name: 'Import File' });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(mockImportCsv).toHaveBeenCalledWith(file);
      expect(screen.getByText(/import complete/i)).toBeInTheDocument();
    });
  });

  it('displays structured validation errors when import fails with validation issues', async () => {
    const errorResponse: ImportResponse = {
      success: false,
      total: 2,
      imported: 0,
      skipped: 0,
      errors: [
        { index: 0, field: 'status', message: 'Row 1: invalid status "INVALID"' },
        { index: 1, field: 'tmdb_id', message: 'Row 2: tmdb_id must be a positive integer' },
      ],
      summary: 'Import failed with 2 validation errors. No personal tracking records were written.',
    };
    mockImportCsv.mockResolvedValue(errorResponse);

    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['bad csv'], 'data.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Import File' }));

    await waitFor(() => {
      expect(screen.getByText(/import failed — validation errors/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/row 1: invalid status "INVALID"/i)).toBeInTheDocument();
    expect(screen.getByText(/row 2: tmdb_id must be a positive integer/i)).toBeInTheDocument();
    expect(screen.getByText(/fix the errors in your file and try again/i)).toBeInTheDocument();
  });

  it('handles general API errors gracefully', async () => {
    mockImportJson.mockRejectedValue(new ApiClientError(500, 'Server crashed during transaction'));

    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['{}'], 'data.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Import File' }));

    await waitFor(() => {
      expect(screen.getByText(/import failed/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Server crashed during transaction')).toBeInTheDocument();
  });

  it('resets file selection and results when Reset button is clicked', async () => {
    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['{}'], 'data.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText('data.json')).toBeInTheDocument();

    const resetButton = screen.getByRole('button', { name: /reset/i });
    fireEvent.click(resetButton);

    expect(screen.queryByText('data.json')).not.toBeInTheDocument();
    expect(screen.getByText(/drop your file here, or click to browse/i)).toBeInTheDocument();
  });

  it('shows loading state while import is in progress', async () => {
    let resolvePromise: (value: ImportResponse) => void;
    const promise = new Promise<ImportResponse>((resolve) => {
      resolvePromise = resolve;
    });
    mockImportJson.mockReturnValue(promise);

    render(<ImportPage />);

    const fileInput = screen.getByLabelText(/file upload input/i);
    const file = new File(['{}'], 'data.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const importButton = screen.getByRole('button', { name: 'Import File' });
    fireEvent.click(importButton);

    expect(screen.getByText(/importing…/i)).toBeInTheDocument();
    expect(importButton).toBeDisabled();

    // Finish import
    resolvePromise!({
      success: true,
      total: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      summary: 'Import file contained no entries.',
    });

    await waitFor(() => {
      expect(screen.queryByText(/importing…/i)).not.toBeInTheDocument();
    });
  });
});
