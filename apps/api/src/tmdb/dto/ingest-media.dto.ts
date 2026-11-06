import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class IngestMediaParamDto {
  @ApiProperty({
    description: 'The Movie Database (TMDB) integer ID',
    example: 550,
  })
  @Type(() => Number)
  @IsInt({ message: 'tmdbId must be an integer' })
  @IsPositive({ message: 'tmdbId must be a positive integer' })
  tmdbId!: number;
}
