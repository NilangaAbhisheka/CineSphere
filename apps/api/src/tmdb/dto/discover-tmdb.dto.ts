import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class TmdbMovieSearchQueryDto {
  @ApiProperty({
    description: 'Search query for movie titles',
    example: 'Inception',
  })
  @IsNotEmpty({ message: 'query must not be empty' })
  @IsString({ message: 'query must be a string' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  query!: string;

  @ApiPropertyOptional({
    description: 'Page number (minimum 1)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Whether to include adult / 18+ titles in the search results',
    example: false,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    return value;
  })
  @IsBoolean({ message: 'includeAdult must be a boolean' })
  includeAdult: boolean = false;

  @ApiPropertyOptional({
    description: 'Filter movies by release year',
    example: 2010,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'year must be an integer' })
  @Min(1888, { message: 'year must be at least 1888' })
  @Max(2100, { message: 'year must not exceed 2100' })
  year?: number;

  @ApiPropertyOptional({
    description: 'Filter movies by primary release year',
    example: 2010,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'primaryReleaseYear must be an integer' })
  @Min(1888, { message: 'primaryReleaseYear must be at least 1888' })
  @Max(2100, { message: 'primaryReleaseYear must not exceed 2100' })
  primaryReleaseYear?: number;
}

export class TmdbTvSearchQueryDto {
  @ApiProperty({
    description: 'Search query for TV show names',
    example: 'Breaking Bad',
  })
  @IsNotEmpty({ message: 'query must not be empty' })
  @IsString({ message: 'query must be a string' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  query!: string;

  @ApiPropertyOptional({
    description: 'Page number (minimum 1)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Filter TV shows by first air date year',
    example: 2008,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'firstAirDateYear must be an integer' })
  @Min(1900, { message: 'firstAirDateYear must be at least 1900' })
  @Max(2100, { message: 'firstAirDateYear must not exceed 2100' })
  firstAirDateYear?: number;

  @ApiPropertyOptional({
    description: 'Whether to include adult / 18+ titles in the search results',
    example: false,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true || value === 1 || value === '1') return true;
    if (value === 'false' || value === false || value === 0 || value === '0') return false;
    return value;
  })
  @IsBoolean({ message: 'includeAdult must be a boolean' })
  includeAdult: boolean = false;
}

export class TmdbPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (minimum 1)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;
}
