import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.CINESPHERE_E2E_DATABASE_URL || process.env.DATABASE_URL;
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Prisma connected successfully to PostgreSQL');
    } catch (error) {
      this.logger.error('Failed to connect to PostgreSQL via Prisma', error);
      // Do not throw on init in development to allow graceful degradation when DB is offline
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected from PostgreSQL');
  }

  async checkConnection(): Promise<{
    connected: boolean;
    latencyMs?: number;
    databaseName?: string;
    host?: string;
    port?: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      const rows = await this.$queryRaw<Array<{ db: string; port: number | null }>>`
        SELECT current_database() AS db, inet_server_port() AS port
      `;
      const row = Array.isArray(rows) ? rows[0] : undefined;
      const rawUrl = process.env.CINESPHERE_E2E_DATABASE_URL || process.env.DATABASE_URL;
      let parsedHost: string | undefined;
      let parsedPort: number | undefined;
      let parsedDb: string | undefined;
      if (rawUrl) {
        try {
          const u = new URL(rawUrl);
          parsedHost = u.hostname || undefined;
          parsedPort = u.port ? Number(u.port) : 5432;
          parsedDb = u.pathname.replace(/^\//, '') || undefined;
        } catch {
          // Ignore malformed URL; rely on SQL identity below
        }
      }
      return {
        connected: true,
        latencyMs: Date.now() - start,
        databaseName: row?.db ?? parsedDb,
        host: parsedHost,
        port: row?.port ?? parsedPort,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown connection error',
      };
    }
  }
}
