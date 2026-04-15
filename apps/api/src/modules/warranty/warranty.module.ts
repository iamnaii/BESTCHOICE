import { Module } from '@nestjs/common';
import { WarrantyService } from './warranty.service';
import { WarrantyCron } from './warranty.cron';

@Module({
  providers: [WarrantyService, WarrantyCron],
  exports: [WarrantyService],
})
export class WarrantyModule {}
