import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PipelineTrackingService } from './pipeline-tracking.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [PipelineTrackingService],
  exports: [PipelineTrackingService],
})
export class ObservabilityModule implements OnModuleInit {
  private readonly logger = new Logger(ObservabilityModule.name);

  constructor(private readonly pipelineTracking: PipelineTrackingService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.pipelineTracking.reconcileStaleRuns();
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Non-fatal startup stale-run reconciliation skipped (${name}).`);
    }
  }
}
