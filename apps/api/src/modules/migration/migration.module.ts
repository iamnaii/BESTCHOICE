import { Module } from '@nestjs/common';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';
import { CustomerPiiModule } from '../customers/customer-pii.module';

@Module({
  // CustomerPiiModule (leaf) — นำเข้าลูกค้าเขียน hash/เข้ารหัส PII + ล็อกเบอร์หลัก
  imports: [CustomerPiiModule],
  controllers: [MigrationController],
  providers: [MigrationService],
  exports: [MigrationService],
})
export class MigrationModule {}
