import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { TmdbModule } from './tmdb/tmdb.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { LibraryModule } from './library/library.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { StatsModule } from './stats/stats.module.js';
import { ImportModule } from './import/import.module.js';
import { ExportModule } from './export/export.module.js';
import { ObservabilityModule } from './observability/observability.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    ObservabilityModule,
    HealthModule,
    TmdbModule,
    CatalogueModule,
    LibraryModule,
    DashboardModule,
    StatsModule,
    ImportModule,
    ExportModule,
  ],
})
export class AppModule {}
