// ==============================================================================
// CineSphere — Export Controller Unit Tests
// Phase 4.5
// ==============================================================================

import type { Response } from 'express';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

describe('ExportController', () => {
  let controller: ExportController;
  let mockExportService: jest.Mocked<ExportService>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockExportService = {
      exportJson: jest.fn(),
      exportCsv: jest.fn(),
    } as unknown as jest.Mocked<ExportService>;

    controller = new ExportController(mockExportService);

    mockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };
  });

  describe('GET /export/json', () => {
    it('sets attachment headers, no-store cache control, and sends JSON string', async () => {
      const mockJson = JSON.stringify({ version: '1.0', entries: [] });
      mockExportService.exportJson.mockResolvedValue(mockJson);

      await controller.exportJson(mockResponse as Response);

      expect(mockExportService.exportJson).toHaveBeenCalledTimes(1);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json; charset=utf-8',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="cinesphere-export.json"',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(mockResponse.send).toHaveBeenCalledWith(mockJson);
    });
  });

  describe('GET /export/csv', () => {
    it('sets attachment headers, no-store cache control, and sends CSV string', async () => {
      const mockCsv = 'tmdb_id,media_type,status,personal_rating,notes,created_at\r\n';
      mockExportService.exportCsv.mockResolvedValue(mockCsv);

      await controller.exportCsv(mockResponse as Response);

      expect(mockExportService.exportCsv).toHaveBeenCalledTimes(1);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="cinesphere-export.csv"',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(mockResponse.send).toHaveBeenCalledWith(mockCsv);
    });
  });
});
