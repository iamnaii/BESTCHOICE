import { Module } from '@nestjs/common';
import { FilterPresetsController } from './filter-presets.controller';
import { FilterPresetsService } from './filter-presets.service';

@Module({
  controllers: [FilterPresetsController],
  providers: [FilterPresetsService],
  exports: [FilterPresetsService],
})
export class FilterPresetsModule {}
