import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { VectorRepository } from './vector.repository.js';

@Global()
@Module({
  providers: [PrismaService, VectorRepository],
  exports: [PrismaService, VectorRepository],
})
export class DatabaseModule {}
