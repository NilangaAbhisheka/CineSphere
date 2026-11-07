import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export type TvSortBy = 'popularity' | 'rating' | 'firstAirDate' | 'name';
export type SortOrder = 'asc' | 'desc';

export class ListTvShowsQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring search across TV show names',
    example: 'Breaking Bad',
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
    example: 18,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'genreId must be an integer' })
  genreId?: number;

  @ApiPropertyOptional({
    description: 'Filter by first air date year',
    example: 2008,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'firstAirDateYear must be an integer' })
  @Min(1900, { message: 'firstAirDateYear must be at least 1900' })
  @Max(2100, { message: 'firstAirDateYear cannot exceed 2100' })
  firstAirDateYear?: number;

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
    description: 'Filter by original language code (e.g. en, ja, ko)',
    example: 'en',
  })
  @IsOptional()
  @IsString({ message: 'language must be a string' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  language?: string;

  @ApiPropertyOptional({
    description: 'Filter by TV show status (e.g. Returning Series, Ended)',
    example: 'Ended',
  })
  @IsOptional()
  @IsString({ message: 'status must be a string' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  status?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['popularity', 'rating', 'firstAirDate', 'name'],
    default: 'popularity',
  })
  @IsOptional()
  @IsIn(['popularity', 'rating', 'firstAirDate', 'name'], {
    message: 'sortBy must be one of: popularity, rating, firstAirDate, name',
  })
  sortBy: TvSortBy = 'popularity';

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
