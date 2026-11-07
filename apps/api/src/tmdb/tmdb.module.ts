import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TmdbHttpClient } from './tmdb-http.client.js';
import { CatalogueRepository } from './catalogue.repository.js';
import { TmdbService } from './tmdb.service.js';
import { TmdbController } from './tmdb.controller.js';
import { DiscoverController } from './discover.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [TmdbController, DiscoverController],
  providers: [TmdbHttpClient, CatalogueRepository, TmdbService],
  exports: [TmdbService, TmdbHttpClient, CatalogueRepository],
})
export class TmdbModule {}
