import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

/**
 * ถังขยะรวม (ก้อน 8 · A10) — อ่าน/กู้ของที่ soft-delete ตาม allow-list ใน `trash-registry.ts`
 * บริการข้ามโมดูลที่ใช้หลังกู้ (journey state · tags) ดึงผ่าน ModuleRef ตอนใช้ (strict: false) เพื่อไม่ผูก import
 */
@Module({
  imports: [AuditModule],
  controllers: [TrashController],
  providers: [TrashService],
  exports: [TrashService],
})
export class TrashModule {}
