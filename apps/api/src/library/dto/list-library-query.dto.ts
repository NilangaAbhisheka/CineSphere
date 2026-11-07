import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LibraryStatus, MediaType } from '@prisma/client';

export class ListLibraryQueryDto {
  @ApiPropertyOptional({ enum: LibraryStatus, description: 'Filter by library tracking status' })
  @IsOptional()
  @IsEnum(LibraryStatus)
  status?: LibraryStatus;

  @ApiPropertyOptional({ enum: MediaType, description: 'Filter by media type (MOVIE or TV)' })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @ApiPropertyOptional({ description: 'Page number (minimum 1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'Items per page (maximum 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Primary sorting field',
    enum: ['updatedAt', 'createdAt', 'personalRating', 'title'],
    default: 'updatedAt',
  })
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'personalRating', 'title'])
  sortBy: 'updatedAt' | 'createdAt' | 'personalRating' | 'title' = 'updatedAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
