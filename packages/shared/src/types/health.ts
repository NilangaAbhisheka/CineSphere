import { VectorExtensionStatus } from './vector.js';

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  database: {
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
  pgvector: VectorExtensionStatus;
  version: string;
}
