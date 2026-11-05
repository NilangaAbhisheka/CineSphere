import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service.js';
import { VectorRepository } from '../database/vector.repository.js';
import { HealthCheckResponse } from '@cinesphere/shared';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorRepo: VectorRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'System Health & Database / pgvector Status' })
  @ApiResponse({
    status: 200,
    description:
      'System health metrics including PostgreSQL connection and pgvector extension status.',
  })
  async getHealth(): Promise<HealthCheckResponse> {
    const dbStatus = await this.prisma.checkConnection();
    const pgvectorStatus = await this.vectorRepo.isPgvectorInstalled();

    const isHealthy = dbStatus.connected && pgvectorStatus.installed;

    return {
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      environment: process.env.NODE_ENV || 'development',
      database: dbStatus,
      pgvector: pgvectorStatus,
      version: '0.1.0',
    };
  }
}
