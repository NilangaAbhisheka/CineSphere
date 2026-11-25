import { PrismaService } from './prisma.service';

describe('PrismaService.checkConnection', () => {
  it('returns SQL instance identity fields when PostgreSQL identity query succeeds', async () => {
    const service = new PrismaService();
    jest.spyOn(service, '$queryRaw').mockResolvedValueOnce([
      {
        db: 'cinesphere',
        server_addr: '172.20.0.2/32',
        port: 5432,
        system_identifier: '7704763478273589286',
        db_oid: 16384,
      },
    ]);

    const result = await service.checkConnection();

    expect(result.connected).toBe(true);
    expect(result.databaseName).toBe('cinesphere');
    expect(result.serverAddress).toBe('172.20.0.2/32');
    expect(result.port).toBe(5432);
    expect(result.systemIdentifier).toBe('7704763478273589286');
    expect(result.databaseOid).toBe(16384);
  });

  it('fails closed when SQL identity query returns incomplete metadata', async () => {
    const service = new PrismaService();
    jest.spyOn(service, '$queryRaw').mockResolvedValueOnce([
      {
        db: 'cinesphere',
        server_addr: '172.20.0.2/32',
        port: 5432,
        system_identifier: null,
        db_oid: 16384,
      },
    ]);

    const result = await service.checkConnection();

    expect(result.connected).toBe(false);
    expect(result.error).toContain('incomplete metadata');
  });

  it('fails closed when SQL identity query throws', async () => {
    const service = new PrismaService();
    jest
      .spyOn(service, '$queryRaw')
      .mockRejectedValueOnce(new Error('permission denied for function pg_control_system'));

    const result = await service.checkConnection();

    expect(result.connected).toBe(false);
    expect(result.error).toContain('pg_control_system');
  });
});
