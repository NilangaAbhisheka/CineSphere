import { IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LibraryStatus } from '@prisma/client';
import { IsHalfStepRating } from './rating-validator.js';

export class UpdateLibraryEntryDto {
  @ApiPropertyOptional({ enum: LibraryStatus, description: 'Updated watch tracking status' })
  @IsOptional()
  @IsEnum(LibraryStatus)
  status?: LibraryStatus;

  @ApiPropertyOptional({
    description: 'Updated personal rating between 1.00 and 10.00 (half-step increments), or null to clear',
    nullable: true,
    example: 9.0,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsHalfStepRating()
  personalRating?: number | null;

  @ApiPropertyOptional({ description: 'Updated personal notes, or null to clear', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  notes?: string | null;
}
