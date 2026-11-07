import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEpisodeProgressDto {
  @ApiProperty({
    description: 'Internal episode UUID (version 4) to mark as watched',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsUUID('4')
  episodeId!: string;
}
