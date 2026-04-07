import { Module } from '@nestjs/common';
import { LegacyImportController } from './legacy-import.controller';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * ⚠️ TEMPORARY MODULE — สำหรับ migration ครั้งเดียวจากโปรแกรมเขียว
 * ลบทั้ง module หลัง import production สำเร็จ
 */
@Module({
  imports: [PrismaModule],
  controllers: [LegacyImportController],
})
export class LegacyImportModule {}
