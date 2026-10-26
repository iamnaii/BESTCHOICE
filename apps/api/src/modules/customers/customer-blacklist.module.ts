import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerPiiModule } from './customer-pii.module';
import { CustomerBlacklistService } from './customer-blacklist.service';

/**
 * ก้อน 5 C3 — โมดูลเล็กแบบ CustomerPiiModule: พึ่ง Prisma + PII เท่านั้น จึง import ได้ทั้งจาก
 * CustomersModule (endpoint อ่านผล) และ ContractsModule (ด่านตอนสร้าง/เปิดใช้สัญญา) โดยไม่มีวงจร
 */
@Module({
  imports: [PrismaModule, CustomerPiiModule],
  providers: [CustomerBlacklistService],
  exports: [CustomerBlacklistService],
})
export class CustomerBlacklistModule {}
