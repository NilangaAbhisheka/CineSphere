import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TmdbModule } from '../tmdb/tmdb.module.js';
import { LibraryRepository } from './library.repository.js';
import { LibraryService } from './library.service.js';
import { LibraryController } from './library.controller.js';

@Module({
  imports: [DatabaseModule, TmdbModule],
  controllers: [LibraryController],
  providers: [LibraryRepository, LibraryService],
  exports: [LibraryRepository, LibraryService],
})
export class LibraryModule {}
