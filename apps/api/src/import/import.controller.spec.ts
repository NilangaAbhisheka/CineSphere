// ==============================================================================
// CineSphere — Import Controller Unit Tests
// Phase 4.4
// ==============================================================================

import { BadRequestException } from '@nestjs/common';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';
import { ImportResponse } from '@cinesphere/shared';

describe('ImportController', () => {
  let controller: ImportController;
  let importService: jest.Mocked<ImportService>;

  beforeEach(() => {
    importService = {
      importJson: jest.fn(),
      importCsv: jest.fn(),
    } as unknown as jest.Mocked<ImportService>;

    controller = new ImportController(importService);
  });

  describe('importJson', () => {
    it('throws BadRequestException if no file is provided', async () => {
      await expect(controller.importJson(undefined as never)).rejects.toThrow(BadRequestException);
      await expect(controller.importJson(undefined as never)).rejects.toThrow('No file uploaded');
    });

    it('delegates file buffer to importService.importJson and returns the result', async () => {
      const mockResult: ImportResponse = {
        success: true,
        total: 1,
        imported: 1,
        skipped: 0,
        errors: [],
        summary: 'Imported 1 entry.',
      };
      importService.importJson.mockResolvedValue(mockResult);

      const fakeFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'backup.json',
        encoding: '7bit',
        mimetype: 'application/json',
        size: 100,
        buffer: Buffer.from('{"version":"1.0","entries":[]}', 'utf-8'),
        destination: '',
        filename: '',
        path: '',
        stream: null as never,
      };

      const result = await controller.importJson(fakeFile);
      expect(importService.importJson).toHaveBeenCalledWith(fakeFile.buffer);
      expect(result).toEqual(mockResult);
    });
  });

  describe('importCsv', () => {
    it('throws BadRequestException if no file is provided', async () => {
      await expect(controller.importCsv(undefined as never)).rejects.toThrow(BadRequestException);
      await expect(controller.importCsv(undefined as never)).rejects.toThrow('No file uploaded');
    });

    it('delegates file buffer to importService.importCsv and returns the result', async () => {
      const mockResult: ImportResponse = {
        success: true,
        total: 1,
        imported: 1,
        skipped: 0,
        errors: [],
        summary: 'Imported 1 entry.',
      };
      importService.importCsv.mockResolvedValue(mockResult);

      const fakeFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'movies.csv',
        encoding: '7bit',
        mimetype: 'text/csv',
        size: 50,
        buffer: Buffer.from('tmdb_id,media_type,status\n550,MOVIE,COMPLETED', 'utf-8'),
        destination: '',
        filename: '',
        path: '',
        stream: null as never,
      };

      const result = await controller.importCsv(fakeFile);
      expect(importService.importCsv).toHaveBeenCalledWith(fakeFile.buffer);
      expect(result).toEqual(mockResult);
    });
  });
});
