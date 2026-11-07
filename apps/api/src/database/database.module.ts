import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { VectorRepository } from './vector.repository.js';
import { SingleUserBootstrap } from './single-user-bootstrap.js';

@Global()
@Module({
  providers: [PrismaService, VectorRepository, SingleUserBootstrap],
  exports: [PrismaService, VectorRepository, SingleUserBootstrap],
})
export class DatabaseModule {}
