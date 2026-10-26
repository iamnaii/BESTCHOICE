import { Module, forwardRef } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InterCompanyModule } from '../inter-company/inter-company.module';
import { JournalModule } from '../journal/journal.module';
import { SaleVoidService } from './services/sale-void.service';
import { SaleWarrantyNotifierService } from './services/sale-warranty-notifier.service';
import { SalesReceiptPublicController } from './sales-receipt-public.controller';
import { SaleReceiptLineService } from './services/sale-receipt-line.service';
import { SaleReceiptPdfService } from './services/sale-receipt-pdf.service';
import { SaleReceiptTokenService } from './services/sale-receipt-token.service';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  // LineOaModule ผูกด้วย forwardRef — โมดูลนั้น import ContractsModule/ChatEngineModule
  // ซึ่งวนกลับมาหา SalesModule ได้ (ทั้งไฟล์นั้นก็ใช้ forwardRef กับเพื่อนบ้านอยู่แล้ว)
  imports: [InterCompanyModule, JournalModule, forwardRef(() => LineOaModule), IntegrationsModule],
  // SalesReceiptPublicController = route สาธารณะผ่าน token (ไม่มี guard) — ดู security.md `sales-receipt-public`
  controllers: [SalesController, SalesReceiptPublicController],
  providers: [SalesService, SaleVoidService, SaleWarrantyNotifierService, SaleReceiptTokenService, SaleReceiptPdfService, SaleReceiptLineService],
  exports: [SalesService, SaleVoidService],
})
export class SalesModule {}
