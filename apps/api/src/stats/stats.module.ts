import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';
import { CLOCK_TOKEN, SystemClock } from './clock.interface.js';

@Module({
  controllers: [StatsController],
  providers: [
    StatsService,
    {
      provide: CLOCK_TOKEN,
      useClass: SystemClock,
    },
  ],
  exports: [StatsService],
})
export class StatsModule {}
