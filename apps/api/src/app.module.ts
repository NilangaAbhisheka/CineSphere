import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { TmdbModule } from './tmdb/tmdb.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    HealthModule,
    TmdbModule,
    CatalogueModule,
  ],
})
export class AppModule {}
