import { Module } from '@nestjs/common';
import { TestModeService } from './test-mode.service';
import { TestModeController } from './test-mode.controller';

@Module({
  controllers: [TestModeController],
  providers: [TestModeService],
  exports: [TestModeService],
})
export class TestModeModule {}
