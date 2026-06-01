import { Module } from '@nestjs/common';
import { ReverseReasonsController } from './reverse-reasons.controller';
import { ReverseReasonsService } from './reverse-reasons.service';

/**
 * InternalControlActionBar — module bundling reverse-reason CRUD endpoints.
 * Exposed via `/settings/reverse-reasons`. PrismaService comes from the
 * global PrismaModule (no need to re-declare).
 */
@Module({
  controllers: [ReverseReasonsController],
  providers: [ReverseReasonsService],
  exports: [ReverseReasonsService],
})
export class ReverseReasonsModule {}
