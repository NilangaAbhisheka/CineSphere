import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export type MovieSortBy = 'popularity' | 'rating' | 'releaseDate' | 'title';
export type SortOrder = 'asc' | 'desc';

export class ListMoviesQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring search across movie titles',
    example: 'Inception',
  })
  @IsOptional()
  @IsString({ message: 'query must be a string' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  query?: string;

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
    description: 'Number of items per page (maximum 100)',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit cannot exceed 100' })
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by TMDB genre integer ID',
    example: 28,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'genreId must be an integer' })
  genreId?: number;

  @ApiPropertyOptional({
    description: 'Filter by movie release year',
    example: 2010,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'year must be an integer' })
  @Min(1888, { message: 'year must be at least 1888' })
  @Max(2100, { message: 'year cannot exceed 2100' })
  year?: number;

  @ApiPropertyOptional({
    description: 'Minimum vote average (0.0 to 10.0)',
    example: 7.5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minRating must be a number' })
  @Min(0, { message: 'minRating cannot be less than 0' })
  @Max(10, { message: 'minRating cannot exceed 10' })
  minRating?: number;

  @ApiPropertyOptional({
    description: 'Maximum vote average (0.0 to 10.0)',
    example: 9.5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxRating must be a number' })
  @Min(0, { message: 'maxRating cannot be less than 0' })
  @Max(10, { message: 'maxRating cannot exceed 10' })
  maxRating?: number;

  @ApiPropertyOptional({
    description: 'Filter by original language code (e.g. en, ja, fr)',
    example: 'en',
  })
  @IsOptional()
  @IsString({ message: 'language must be a string' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  language?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['popularity', 'rating', 'releaseDate', 'title'],
    default: 'popularity',
  })
  @IsOptional()
  @IsIn(['popularity', 'rating', 'releaseDate', 'title'], {
    message: 'sortBy must be one of: popularity, rating, releaseDate, title',
  })
  sortBy: MovieSortBy = 'popularity';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'], {
    message: 'sortOrder must be one of: asc, desc',
  })
  sortOrder: SortOrder = 'desc';
}
