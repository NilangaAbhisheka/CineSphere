import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class ActivityQueryDto {
  @ApiPropertyOptional({
    description: 'Start month in YYYY-MM format (inclusive, UTC).',
    example: '2025-12',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'from must be a valid month in YYYY-MM format',
  })
  from?: string;

  @ApiPropertyOptional({
    description: 'End month in YYYY-MM format (inclusive, UTC).',
    example: '2026-11',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'to must be a valid month in YYYY-MM format',
  })
  to?: string;
}
