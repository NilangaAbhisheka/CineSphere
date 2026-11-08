import { ConfigService } from '@nestjs/config';
import { SingleUserBootstrap } from './single-user-bootstrap.js';
import { PrismaService } from './prisma.service.js';

describe('SingleUserBootstrap', () => {
  let bootstrap: SingleUserBootstrap;
  let configService: jest.Mocked<ConfigService>;
  let prismaService: {
    user: {
      upsert: jest.Mock;
    };
  };

  const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    prismaService = {
      user: {
        upsert: jest.fn().mockResolvedValue({
          id: VALID_UUID,
          displayName: 'CineSphere User',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };

    bootstrap = new SingleUserBootstrap(configService, prismaService as unknown as PrismaService);
  });

  it('fails application bootstrap when CINESPHERE_SINGLE_USER_ID is missing', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(bootstrap.onModuleInit()).rejects.toThrow(
      /Missing required environment variable: CINESPHERE_SINGLE_USER_ID/,
    );
    expect(prismaService.user.upsert).not.toHaveBeenCalled();
  });

  it('fails application bootstrap when CINESPHERE_SINGLE_USER_ID is not a valid UUID', async () => {
    configService.get.mockReturnValue('not-a-valid-uuid');

    await expect(bootstrap.onModuleInit()).rejects.toThrow(
      /Invalid CINESPHERE_SINGLE_USER_ID: "not-a-valid-uuid"/,
    );
    expect(prismaService.user.upsert).not.toHaveBeenCalled();
  });

  it('fails when CINESPHERE_SINGLE_USER_ID is an empty string', async () => {
    configService.get.mockReturnValue('');

    await expect(bootstrap.onModuleInit()).rejects.toThrow(
      /Missing required environment variable: CINESPHERE_SINGLE_USER_ID/,
    );
    expect(prismaService.user.upsert).not.toHaveBeenCalled();
  });

  it('successfully upserts user with displayName CineSphere User when UUID is valid', async () => {
    configService.get.mockReturnValue(VALID_UUID);

    await bootstrap.onModuleInit();

    expect(prismaService.user.upsert).toHaveBeenCalledTimes(1);
    expect(prismaService.user.upsert).toHaveBeenCalledWith({
      where: { id: VALID_UUID },
      update: {},
      create: {
        id: VALID_UUID,
        displayName: 'CineSphere User',
      },
    });
    expect(bootstrap.getUserId()).toBe(VALID_UUID);
  });

  it('is strictly idempotent on repeated calls', async () => {
    configService.get.mockReturnValue(VALID_UUID);

    const firstResult = await bootstrap.bootstrap();
    const secondResult = await bootstrap.bootstrap();

    expect(firstResult).toBe(VALID_UUID);
    expect(secondResult).toBe(VALID_UUID);
    expect(prismaService.user.upsert).toHaveBeenCalledTimes(2);
    expect(bootstrap.getUserId()).toBe(VALID_UUID);
  });

  it('throws in getUserId if bootstrap was never run and environment is missing', () => {
    configService.get.mockReturnValue(undefined);
    expect(() => bootstrap.getUserId()).toThrow(/Single-user bootstrap has not been initialized/);
  });
});
