import { Module, forwardRef } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InterCompanyModule } from '../inter-company/inter-company.module';
import { JournalModule } from '../journal/journal.module';
import { SaleVoidService } from './services/sale-void.service';
import { SaleWarrantyNotifierService } from './services/sale-warranty-notifier.service';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  // LineOaModule ผูกด้วย forwardRef — โมดูลนั้น import ContractsModule/ChatEngineModule
  // ซึ่งวนกลับมาหา SalesModule ได้ (ทั้งไฟล์นั้นก็ใช้ forwardRef กับเพื่อนบ้านอยู่แล้ว)
  imports: [InterCompanyModule, JournalModule, forwardRef(() => LineOaModule), IntegrationsModule],
  controllers: [SalesController],
  providers: [SalesService, SaleVoidService, SaleWarrantyNotifierService],
  exports: [SalesService, SaleVoidService],
})
export class SalesModule {}
