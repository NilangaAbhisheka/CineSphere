// ==============================================================================
// CineSphere — Export Controller
// Phase 4.5: REST endpoints for JSON and CSV personal library export.
//
// GET /api/export/json — Downloads full-fidelity JSON backup (cinesphere-export.json)
// GET /api/export/csv  — Downloads flat library CSV projection (cinesphere-export.csv)
// ==============================================================================

import { Controller, Get, Logger, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ExportService } from './export.service.js';

@ApiTags('export')
@Controller('export')
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(private readonly exportService: ExportService) {}

  @Get('json')
  @ApiOperation({
    summary: 'Export personal library as full-fidelity JSON',
    description:
      'Exports all library entries, movie viewing history, TV episode progress, and season ratings ' +
      'belonging to the current user. Returns a downloadable JSON backup attachment compatible ' +
      'with CineSphere JSON Importer v1.0. Served with no-store cache control headers.',
  })
  @ApiResponse({
    status: 200,
    description: 'JSON file attachment containing the user library backup.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            version: { type: 'string', example: '1.0' },
            exportedAt: { type: 'string', format: 'date-time' },
            entries: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  })
  async exportJson(@Res() res: Response): Promise<void> {
    this.logger.log('JSON library export requested');

    const jsonString = await this.exportService.exportJson();

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cinesphere-export.json"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    res.send(jsonString);
  }

  @Get('csv')
  @ApiOperation({
    summary: 'Export personal library as flat CSV',
    description:
      'Exports library entries as a flat RFC 4180 compliant CSV spreadsheet attachment. ' +
      'Columns: tmdb_id,media_type,status,personal_rating,notes,created_at. ' +
      'Does not contain movie viewing history, TV episode progress, or season ratings. ' +
      'Served with no-store cache control headers.',
  })
  @ApiResponse({
    status: 200,
    description: 'CSV file attachment containing flat library records.',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          example:
            'tmdb_id,media_type,status,personal_rating,notes,created_at\\r\\n550,movie,COMPLETED,8.5,Notes,2024-01-15T10:00:00.000Z',
        },
      },
    },
  })
  async exportCsv(@Res() res: Response): Promise<void> {
    this.logger.log('CSV library export requested');

    const csvString = await this.exportService.exportCsv();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cinesphere-export.csv"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    res.send(csvString);
  }
}
