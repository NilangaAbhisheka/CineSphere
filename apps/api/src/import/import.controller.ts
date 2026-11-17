// ==============================================================================
// CineSphere — Import Controller
// Phase 4.4: REST endpoints for JSON and CSV import.
//
// POST /api/import/json — Upload a JSON import file (multipart/form-data, field: "file")
// POST /api/import/csv  — Upload a CSV import file  (multipart/form-data, field: "file")
// ==============================================================================

import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ImportResponse } from '@cinesphere/shared';
import { ImportService } from './import.service.js';

@ApiTags('import')
@Controller('import')
export class ImportController {
  private readonly logger = new Logger(ImportController.name);

  constructor(private readonly importService: ImportService) {}

  @Post('json')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB hard limit at multer level
      fileFilter: (_req, file, cb) => {
        const isJson =
          file.mimetype === 'application/json' ||
          file.mimetype === 'text/plain' ||
          file.originalname.toLowerCase().endsWith('.json');
        if (!isJson) {
          cb(
            new BadRequestException(
              'Only JSON files are accepted for JSON import. Please upload a file with a .json extension.',
            ),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import personal library data from a JSON file',
    description:
      'Accepts a JSON file matching the CineSphere import schema v1.0. ' +
      'Validates the entire payload before writing any data. ' +
      'All imports are atomic — a failure rolls back all changes. ' +
      'Existing library entries are skipped (not overwritten).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'JSON import file (.json)' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 200, description: 'Import completed (check success field for result).' })
  @ApiResponse({ status: 400, description: 'Validation errors or malformed file.' })
  @ApiResponse({ status: 413, description: 'File exceeds the 5 MB size limit.' })
  async importJson(@UploadedFile() file: Express.Multer.File): Promise<ImportResponse> {
    if (!file) {
      throw new BadRequestException('No file uploaded. Send the JSON file in a "file" form field.');
    }

    this.logger.log(
      `JSON import requested: filename="${file.originalname}", size=${file.size} bytes`,
    );

    const result = await this.importService.importJson(file.buffer);

    this.logger.log(
      `JSON import complete: imported=${result.imported}, skipped=${result.skipped}, errors=${result.errors.length}`,
    );

    return result;
  }

  @Post('csv')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB hard limit at multer level
      fileFilter: (_req, file, cb) => {
        const isCsv =
          file.mimetype === 'text/csv' ||
          file.mimetype === 'text/plain' ||
          file.mimetype === 'application/csv' ||
          file.originalname.toLowerCase().endsWith('.csv');
        if (!isCsv) {
          cb(
            new BadRequestException(
              'Only CSV files are accepted for CSV import. Please upload a file with a .csv extension.',
            ),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import library data from a flat CSV file',
    description:
      'Accepts a CSV file with the CineSphere flat import format. ' +
      'Required columns: tmdb_id, media_type, status. ' +
      'Optional columns: personal_rating, notes, created_at. ' +
      'CSV import supports library entries only. ' +
      'For viewing history, episode progress, and season ratings use JSON import.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'CSV import file (.csv)' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 200, description: 'Import completed (check success field for result).' })
  @ApiResponse({ status: 400, description: 'Validation errors or malformed file.' })
  @ApiResponse({ status: 413, description: 'File exceeds the 2 MB size limit.' })
  async importCsv(@UploadedFile() file: Express.Multer.File): Promise<ImportResponse> {
    if (!file) {
      throw new BadRequestException('No file uploaded. Send the CSV file in a "file" form field.');
    }

    this.logger.log(
      `CSV import requested: filename="${file.originalname}", size=${file.size} bytes`,
    );

    const result = await this.importService.importCsv(file.buffer);

    this.logger.log(
      `CSV import complete: imported=${result.imported}, skipped=${result.skipped}, errors=${result.errors.length}`,
    );

    return result;
  }
}
