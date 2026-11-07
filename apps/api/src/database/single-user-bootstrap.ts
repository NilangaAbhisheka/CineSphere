import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class SingleUserBootstrap implements OnModuleInit {
  private readonly logger = new Logger(SingleUserBootstrap.name);
  private singleUserId!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrap();
  }

  async bootstrap(): Promise<string> {
    const rawId = this.configService.get<string>('CINESPHERE_SINGLE_USER_ID');
    if (!rawId) {
      throw new Error(
        'Missing required environment variable: CINESPHERE_SINGLE_USER_ID. A valid RFC 4122 v4 UUID is required for single-user operation.',
      );
    }

    if (!isUUID(rawId, '4')) {
      throw new Error(
        `Invalid CINESPHERE_SINGLE_USER_ID: "${rawId}". Expected a valid RFC 4122 version 4 UUID.`,
      );
    }

    this.singleUserId = rawId;

    await this.prisma.user.upsert({
      where: { id: this.singleUserId },
      update: {},
      create: {
        id: this.singleUserId,
        displayName: 'CineSphere User',
      },
    });

    this.logger.log(`Deterministic single-user verified: ${this.singleUserId}`);
    return this.singleUserId;
  }

  getUserId(): string {
    if (!this.singleUserId) {
      const rawId = this.configService.get<string>('CINESPHERE_SINGLE_USER_ID');
      if (rawId && isUUID(rawId, '4')) {
        this.singleUserId = rawId;
      } else {
        throw new Error('Single-user bootstrap has not been initialized or configuration is invalid.');
      }
    }
    return this.singleUserId;
  }
}
