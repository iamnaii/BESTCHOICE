import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { StorageModule } from '../storage/storage.module';
import { EquityController } from './equity.controller';
import { EquityService } from './equity.service';
import { EquityDocNumberService } from './services/equity-doc-number.service';
import { EquityAttachmentService } from './services/equity-attachment.service';

// PrismaService global ผ่าน PrismaModule (@Global) — ไม่ต้อง import
// JournalModule ให้ JournalAutoService + CompanyResolverService (ตรวจ exports ของ
// journal.module.ts — ถ้า CompanyResolverService ไม่ถูก export ให้เพิ่มใน exports ที่นั่น)
@Module({
  imports: [JournalModule, StorageModule],
  controllers: [EquityController],
  providers: [EquityService, EquityDocNumberService, EquityAttachmentService],
  exports: [EquityService],
})
export class EquityModule {}
