import { Module } from '@nestjs/common';
import { TmdbModule } from '../tmdb/tmdb.module.js';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { ProvenanceAuditService } from './provenance-audit.service.js';

@Module({
  imports: [TmdbModule],
  controllers: [CatalogueController],
  providers: [CatalogueService, ProvenanceAuditService],
  exports: [CatalogueService, ProvenanceAuditService],
})
export class CatalogueModule {}
