import { HealthController } from './health.controller';
import { PrismaService } from '../database/prisma.service';
import { VectorRepository } from '../database/vector.repository';

describe('HealthController', () => {
  let controller: HealthController;
  let prismaService: jest.Mocked<PrismaService>;
  let vectorRepository: jest.Mocked<VectorRepository>;

  beforeEach(() => {
    prismaService = {
      checkConnection: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

    vectorRepository = {
      isPgvectorInstalled: jest.fn(),
    } as unknown as jest.Mocked<VectorRepository>;

    controller = new HealthController(prismaService, vectorRepository);
  });

  it('should return status "ok" when both PostgreSQL and pgvector are healthy', async () => {
    prismaService.checkConnection.mockResolvedValueOnce({
      connected: true,
      latencyMs: 3,
    });

    vectorRepository.isPgvectorInstalled.mockResolvedValueOnce({
      installed: true,
      version: '0.8.0',
      comment: 'vector extension',
    });

    const response = await controller.getHealth();

    expect(response.status).toBe('ok');
    expect(response.database.connected).toBe(true);
    expect(response.pgvector.installed).toBe(true);
    expect(response.version).toBe('0.1.0');
    expect(response.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('should return status "error" when database is disconnected', async () => {
    prismaService.checkConnection.mockResolvedValueOnce({
      connected: false,
      error: 'Connection refused',
    });

    vectorRepository.isPgvectorInstalled.mockResolvedValueOnce({
      installed: false,
      version: null,
      comment: null,
    });

    const response = await controller.getHealth();

    expect(response.status).toBe('error');
    expect(response.database.connected).toBe(false);
    expect(response.database.error).toBe('Connection refused');
  });

  it('should return status "error" when pgvector is not installed even if DB is connected', async () => {
    prismaService.checkConnection.mockResolvedValueOnce({
      connected: true,
      latencyMs: 2,
    });

    vectorRepository.isPgvectorInstalled.mockResolvedValueOnce({
      installed: false,
      version: null,
      comment: 'Extension missing',
    });

    const response = await controller.getHealth();

    expect(response.status).toBe('error');
    expect(response.database.connected).toBe(true);
    expect(response.pgvector.installed).toBe(false);
  });
});
