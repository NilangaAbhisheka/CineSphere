import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkAllWatchedDto {
  @ApiPropertyOptional({
    description: 'Whether to include special season episodes (season 0). Defaults to false.',
    default: false,
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeSpecials: boolean = false;
}
