import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsHalfStepRating } from './rating-validator.js';

export class CreateSeasonRatingDto {
  @ApiProperty({
    description: 'Internal season UUID (version 4) to rate',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsUUID('4')
  seasonId!: string;

  @ApiProperty({
    description: 'Season rating between 1.00 and 10.00 (half-step increments)',
    example: 8.5,
  })
  @IsHalfStepRating()
  rating!: number;
}
