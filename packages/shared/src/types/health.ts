import { VectorExtensionStatus } from './vector.js';

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  database: {
    connected: boolean;
    latencyMs?: number;
    databaseName?: string;
    host?: string;
    port?: number;
    serverAddress?: string;
    systemIdentifier?: string;
    databaseOid?: number;
    error?: string;
  };
  pgvector: VectorExtensionStatus;
  version: string;
}
