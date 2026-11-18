// ==============================================================================
// CineSphere — Export Module
// Phase 4.5: Data Export
// ==============================================================================

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
