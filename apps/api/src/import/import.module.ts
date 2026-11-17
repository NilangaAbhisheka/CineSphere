import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TmdbModule } from '../tmdb/tmdb.module.js';
import { ImportService } from './import.service.js';
import { ImportController } from './import.controller.js';

@Module({
  imports: [DatabaseModule, TmdbModule],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
