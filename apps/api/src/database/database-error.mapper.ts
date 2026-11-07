import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

export class DatabaseErrorMapper {
  private static readonly logger = new Logger(DatabaseErrorMapper.name);

  /**
   * Translates Prisma and PostgreSQL exceptions into appropriate NestJS HTTP exceptions.
   * If the error is already an HttpException, it is returned as-is.
   */
  public static translate(error: unknown, fallbackMessage?: string): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    // 1. Prisma Known Request Errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return DatabaseErrorMapper.handleKnownRequestError(error);
    }

    // 2. Prisma Unknown Request Errors (includes model-level triggers P0001 and CHECK constraints 23514)
    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      return DatabaseErrorMapper.handleUnknownRequestError(error);
    }

    // 3. PostgreSQL Raw Client Errors (e.g. pg package DatabaseError with code)
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message || '';

      if (code === '23505') {
        return new ConflictException('A duplicate record already exists.');
      }
      if (code === '23503') {
        return new NotFoundException('Referenced record does not exist or deletion is restricted.');
      }
      if (code === '23514') {
        return DatabaseErrorMapper.mapCheckConstraintError(message);
      }
      if (code === 'P0001') {
        return DatabaseErrorMapper.mapTriggerError(message);
      }
    }

    DatabaseErrorMapper.logger.error('Unhandled database error:', error);
    return new InternalServerErrorException(fallbackMessage || 'An unexpected database error occurred.');
  }

  private static handleKnownRequestError(error: Prisma.PrismaClientKnownRequestError): HttpException {
    switch (error.code) {
      case 'P2002': {
        // Unique constraint violation (23505)
        const target = error.meta?.target;
        const targetList = Array.isArray(target) ? target.map(String) : [];

        if (
          targetList.includes('user_id') &&
          (targetList.includes('movie_id') || targetList.includes('tv_show_id'))
        ) {
          return new ConflictException('This title is already in your library.');
        }

        if (targetList.includes('library_entry_id') && targetList.includes('season_id')) {
          return new ConflictException('Season rating already exists for this season.');
        }

        if (targetList.includes('library_entry_id') && targetList.includes('episode_id')) {
          return new ConflictException('Episode progress already exists for this episode.');
        }

        const fieldDesc = targetList.length > 0 ? targetList.join(', ') : 'field';
        return new ConflictException(`Unique constraint violation on ${fieldDesc}.`);
      }

      case 'P2003': {
        // Foreign key constraint violation (23503)
        const constraint = String(error.meta?.constraint || error.meta?.field_name || '');
        if (constraint.includes('movie_id')) {
          return new NotFoundException('Referenced movie does not exist.');
        }
        if (constraint.includes('tv_show_id')) {
          return new NotFoundException('Referenced TV show does not exist.');
        }
        if (constraint.includes('episode_id') || constraint.includes('episodes')) {
          return new NotFoundException('Referenced episode does not exist.');
        }
        if (constraint.includes('season_id') || constraint.includes('seasons')) {
          return new NotFoundException('Referenced season does not exist.');
        }
        if (constraint.includes('user_id')) {
          return new NotFoundException('Referenced user does not exist.');
        }
        return new NotFoundException('Referenced entity does not exist or deletion is restricted.');
      }

      case 'P2025': {
        // Record to update or delete not found
        return new NotFoundException('The requested library resource was not found.');
      }

      case 'P2010': {
        // Raw query failed with PostgreSQL error
        if (error.meta?.code === 'P0001') {
          const rawMsg = String(error.meta?.message || error.message || '');
          return DatabaseErrorMapper.mapTriggerError(rawMsg);
        }
        return new BadRequestException('Database query execution failed.');
      }

      default:
        return new BadRequestException(`Database operation failed: ${error.message}`);
    }
  }

  private static handleUnknownRequestError(error: Prisma.PrismaClientUnknownRequestError): HttpException {
    const msg = error.message;

    // Check for trigger-raised exception (P0001)
    if (msg.includes('P0001')) {
      return DatabaseErrorMapper.mapTriggerError(msg);
    }

    // Check for CHECK constraint violation (23514)
    if (msg.includes('23514') || msg.includes('chk_')) {
      return DatabaseErrorMapper.mapCheckConstraintError(msg);
    }

    return new BadRequestException('Database constraint or operational check failed.');
  }

  private static mapTriggerError(message: string): HttpException {
    // Extract readable portion of message
    let cleanMessage = message;
    const match = message.match(/ERROR:\s*(.+?)(?:\n|$)/);
    if (match && match[1]) {
      cleanMessage = match[1].trim();
    }

    // Parent modification protections
    if (
      cleanMessage.includes('Cannot modify') ||
      cleanMessage.includes('Cannot reassign') ||
      cleanMessage.includes('protect_')
    ) {
      return new ConflictException(cleanMessage);
    }

    // Child relationship validation (e.g. episode belongs to another TV show)
    if (cleanMessage.includes('tracks tvShow') || cleanMessage.includes('belongs to tvShow')) {
      return new BadRequestException(cleanMessage);
    }

    return new BadRequestException(cleanMessage || 'Relationship ownership validation failed.');
  }

  private static mapCheckConstraintError(message: string): HttpException {
    if (
      message.includes('chk_user_library_entries_personal_rating_half_step') ||
      message.includes('chk_viewing_events_rating_half_step') ||
      message.includes('chk_season_ratings_rating_half_step')
    ) {
      return new BadRequestException('Rating must be between 1.00 and 10.00 in half-step increments (e.g., 7.0, 7.5).');
    }

    if (message.includes('chk_user_library_entries_media_type_xor')) {
      return new BadRequestException('Library entry must reference either a movie or a TV show, consistent with mediaType.');
    }

    return new BadRequestException('Value violates database validation constraints.');
  }
}
