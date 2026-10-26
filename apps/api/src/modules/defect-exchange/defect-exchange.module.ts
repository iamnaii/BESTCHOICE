import { Module } from '@nestjs/common';
import { DefectExchangeController } from './defect-exchange.controller';
import { DefectExchangeService } from './defect-exchange.service';
import { JournalModule } from '../journal/journal.module';
import { RepairTicketsModule } from '../repair-tickets/repair-tickets.module';
// 15ข — เลขที่ใบลดหนี้ตอนเปลี่ยนเครื่อง: ReceiptsModule ไม่ export ReceiptNumberService (และ import ReceiptsModule ตรงเสี่ยงวงจร
// ผ่าน LineOa/Contracts) · class มีแค่ PrismaService เป็น dependency จึง provide ตรงที่นี่ได้ (advisory lock อยู่ที่ DB)
import { ReceiptNumberService } from '../receipts/services/receipt-number.service';

@Module({
  imports: [JournalModule, RepairTicketsModule],
  controllers: [DefectExchangeController],
  providers: [DefectExchangeService, ReceiptNumberService],
  exports: [DefectExchangeService],
})
export class DefectExchangeModule {}
