import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType, LibraryStatus } from '@prisma/client';
import { IsHalfStepRating } from './rating-validator.js';

export class CreateLibraryEntryDto {
  @ApiProperty({ enum: MediaType, description: 'Media type (MOVIE or TV)', example: MediaType.MOVIE })
  @IsEnum(MediaType)
  mediaType!: MediaType;

  @ApiPropertyOptional({ description: 'TMDB numeric identifier', example: 550 })
  @IsOptional()
  @IsInt()
  @Min(1)
  tmdbId?: number;

  @ApiPropertyOptional({ description: 'Internal media UUID (movie or TV show)' })
  @IsOptional()
  @IsUUID('4')
  mediaId?: string;

  @ApiProperty({ enum: LibraryStatus, description: 'Watch tracking status', example: LibraryStatus.PLAN_TO_WATCH })
  @IsEnum(LibraryStatus)
  status!: LibraryStatus;

  @ApiPropertyOptional({
    description: 'Personal rating between 1.00 and 10.00 (half-step increments)',
    example: 8.5,
  })
  @IsOptional()
  @IsHalfStepRating()
  personalRating?: number;

  @ApiPropertyOptional({ description: 'Personal notes', example: 'Recommended by a friend' })
  @IsOptional()
  @IsString()
  notes?: string;
}
