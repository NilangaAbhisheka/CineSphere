import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseErrorMapper } from './database-error.mapper.js';

describe('DatabaseErrorMapper', () => {
  it('returns HttpException instances directly without modification', () => {
    const original = new NotFoundException('Custom not found');
    const result = DatabaseErrorMapper.translate(original);
    expect(result).toBe(original);
    expect(result.getStatus()).toBe(404);
  });

  describe('PrismaClientKnownRequestError handling', () => {
    it('maps P2002 for user_id and movie_id to ConflictException', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.4.0',
        meta: { target: ['user_id', 'movie_id'] },
      });
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(ConflictException);
      expect(result.message).toContain('This title is already in your library.');
    });

    it('maps P2002 for season_ratings to ConflictException', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.4.0',
        meta: { target: ['library_entry_id', 'season_id'] },
      });
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(ConflictException);
      expect(result.message).toContain('Season rating already exists for this season.');
    });

    it('maps P2003 foreign key error for movie_id to NotFoundException', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Foreign key failed', {
        code: 'P2003',
        clientVersion: '6.4.0',
        meta: { constraint: 'user_library_entries_movie_id_fkey' },
      });
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(NotFoundException);
      expect(result.message).toContain('Referenced movie does not exist.');
    });

    it('maps P2025 not found error to NotFoundException', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.4.0',
      });
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(NotFoundException);
      expect(result.message).toContain('The requested library resource was not found.');
    });

    it('maps P2010 with meta.code P0001 (raw query trigger exception) to appropriate HttpException', () => {
      const error = new Prisma.PrismaClientKnownRequestError('Raw query failed', {
        code: 'P2010',
        clientVersion: '6.4.0',
        meta: {
          code: 'P0001',
          message: 'ERROR: Cannot modify tv_show_id because episode progress exists',
        },
      });
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(ConflictException);
      expect(result.message).toContain('Cannot modify tv_show_id');
    });
  });

  describe('PrismaClientUnknownRequestError handling', () => {
    it('maps trigger P0001 with ownership mismatch to BadRequestException', () => {
      const error = new Prisma.PrismaClientUnknownRequestError(
        'PostgresError { code: "P0001", message: "ERROR: Episode e1 belongs to tvShow s1, but libraryEntry tracks tvShow s2" }',
        { clientVersion: '6.4.0' },
      );
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(BadRequestException);
      expect(result.message).toContain('tracks tvShow');
    });

    it('maps trigger P0001 with parent protection to ConflictException', () => {
      const error = new Prisma.PrismaClientUnknownRequestError(
        'PostgresError { code: "P0001", message: "ERROR: Cannot modify tv_show_id on user_library_entry" }',
        { clientVersion: '6.4.0' },
      );
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(ConflictException);
      expect(result.message).toContain('Cannot modify tv_show_id');
    });

    it('maps half-step rating CHECK constraint error to BadRequestException', () => {
      const error = new Prisma.PrismaClientUnknownRequestError(
        'chk_user_library_entries_personal_rating_half_step violated (23514)',
        { clientVersion: '6.4.0' },
      );
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(BadRequestException);
      expect(result.message).toContain(
        'Rating must be between 1.00 and 10.00 in half-step increments',
      );
    });

    it('maps XOR media_type CHECK constraint error to BadRequestException', () => {
      const error = new Prisma.PrismaClientUnknownRequestError(
        'chk_user_library_entries_media_type_xor violated (23514)',
        { clientVersion: '6.4.0' },
      );
      const result = DatabaseErrorMapper.translate(error);
      expect(result).toBeInstanceOf(BadRequestException);
      expect(result.message).toContain('Library entry must reference either a movie or a TV show');
    });
  });

  describe('Fallback and unhandled error handling', () => {
    it('maps unhandled generic Error to InternalServerErrorException', () => {
      const error = new Error('Disk failure');
      const result = DatabaseErrorMapper.translate(error, 'Fallback message');
      expect(result).toBeInstanceOf(InternalServerErrorException);
      expect(result.message).toBe('Fallback message');
    });
  });
});
