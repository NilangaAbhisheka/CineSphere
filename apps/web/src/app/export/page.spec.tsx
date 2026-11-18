/**
 * export/page.spec.tsx
 *
 * Component tests for ExportPage.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExportPage from './page';
import { apiClient, ApiClientError } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    exportJsonBlob: jest.fn(),
    exportCsvBlob: jest.fn(),
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

describe('ExportPage Component', () => {
  const mockExportJsonBlob = apiClient.exportJsonBlob as jest.MockedFunction<
    typeof apiClient.exportJsonBlob
  >;
  const mockExportCsvBlob = apiClient.exportCsvBlob as jest.MockedFunction<
    typeof apiClient.exportCsvBlob
  >;

  let originalCreateObjectURL: typeof window.URL.createObjectURL;
  let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;

  beforeAll(() => {
    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    window.URL.revokeObjectURL = jest.fn();
  });

  afterAll(() => {
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders page header, format cards, and format warnings', () => {
    render(<ExportPage />);

    expect(screen.getByRole('heading', { name: /export library data/i })).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
    expect(screen.getByText(/spreadsheet-friendly/i)).toBeInTheDocument();
    expect(screen.getByText(/notice: flat format limitations/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to my library/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /import data/i })).toBeInTheDocument();
  });

  it('triggers JSON export download and shows success message', async () => {
    const mockBlob = new Blob(['{"version":"1.0"}'], { type: 'application/json' });
    mockExportJsonBlob.mockResolvedValue({
      blob: mockBlob,
      filename: 'cinesphere-export.json',
    });

    render(<ExportPage />);

    const jsonBtn = screen.getByRole('button', { name: /export as json/i });
    fireEvent.click(jsonBtn);

    await waitFor(() => {
      expect(mockExportJsonBlob).toHaveBeenCalledTimes(1);
    });

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    await waitFor(() => {
      expect(
        screen.getByText(/successfully exported your library as json \(cinesphere-export\.json\)/i),
      ).toBeInTheDocument();
    });
  });

  it('triggers CSV export download and shows success message', async () => {
    const mockBlob = new Blob(['tmdb_id,media_type,status\r\n'], { type: 'text/csv' });
    mockExportCsvBlob.mockResolvedValue({
      blob: mockBlob,
      filename: 'cinesphere-export.csv',
    });

    render(<ExportPage />);

    const csvBtn = screen.getByRole('button', { name: /export as csv/i });
    fireEvent.click(csvBtn);

    await waitFor(() => {
      expect(mockExportCsvBlob).toHaveBeenCalledTimes(1);
    });

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    await waitFor(() => {
      expect(
        screen.getByText(/successfully exported your library as csv \(cinesphere-export\.csv\)/i),
      ).toBeInTheDocument();
    });
  });

  it('displays error alert banner when export fails and dismisses it on click', async () => {
    mockExportJsonBlob.mockRejectedValue(
      new ApiClientError(500, 'Database snapshot failure during export'),
    );

    render(<ExportPage />);

    const jsonBtn = screen.getByRole('button', { name: /export as json/i });
    fireEvent.click(jsonBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Database snapshot failure during export')).toBeInTheDocument();

    // Dismiss error
    const dismissBtn = screen.getByRole('button', { name: /dismiss error message/i });
    fireEvent.click(dismissBtn);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
