import { ApiProperty } from '@nestjs/swagger';
import { IsHalfStepRating } from './rating-validator.js';

export class UpdateSeasonRatingDto {
  @ApiProperty({
    description: 'Updated season rating between 1.00 and 10.00 (half-step increments)',
    example: 9.0,
  })
  @IsHalfStepRating()
  rating!: number;
}
