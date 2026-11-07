import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsHalfStepRating } from './rating-validator.js';

export class CreateViewingEventDto {
  @ApiPropertyOptional({
    description: 'Timestamp when the media was watched (ISO 8601). Defaults to current time.',
    example: '2026-11-07T20:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  watchedAt?: string;

  @ApiPropertyOptional({
    description: 'Specific rating for this viewing session between 1.00 and 10.00 (half-step increments)',
    example: 8.0,
  })
  @IsOptional()
  @IsHalfStepRating()
  rating?: number;

  @ApiPropertyOptional({
    description: 'Personal notes or commentary for this viewing event',
    example: 'Watched with friends in IMAX',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
