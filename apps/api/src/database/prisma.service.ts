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
    serverAddress?: string;
    systemIdentifier?: string;
    databaseOid?: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      const rows = await this.$queryRaw<
        Array<{
          db: string;
          server_addr: string | null;
          port: number | null;
          system_identifier: string | null;
          db_oid: number | null;
        }>
      >`
        SELECT
          current_database() AS db,
          CAST(inet_server_addr() AS TEXT) AS server_addr,
          inet_server_port() AS port,
          (SELECT system_identifier::TEXT FROM pg_control_system()) AS system_identifier,
          (SELECT oid::INT FROM pg_database WHERE datname = current_database()) AS db_oid
      `;
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row?.db || row.port == null || !row.system_identifier || row.db_oid == null) {
        return {
          connected: false,
          error: 'Database instance identity query returned incomplete metadata.',
        };
      }
      const rawUrl = process.env.CINESPHERE_E2E_DATABASE_URL || process.env.DATABASE_URL;
      let parsedHost: string | undefined;
      if (rawUrl) {
        try {
          parsedHost = new URL(rawUrl).hostname || undefined;
        } catch {
          // Ignore malformed URL; SQL identity fields above are authoritative
        }
      }
      return {
        connected: true,
        latencyMs: Date.now() - start,
        databaseName: row.db,
        host: parsedHost,
        port: row.port,
        serverAddress: row.server_addr ?? undefined,
        systemIdentifier: row.system_identifier,
        databaseOid: row.db_oid,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown connection error',
      };
    }
  }
}
