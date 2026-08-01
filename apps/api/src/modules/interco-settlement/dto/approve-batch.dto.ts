import { IsDateString, IsOptional } from 'class-validator';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — body ตอนอนุมัติรอบจ่าย (optional backdate).
 *
 * `postedAt` lets a backdated batch (D2/D4 — โหมดย้อนหลัง) pin the JE's
 * `postedAt` to a date in an already-open period even though `transferDate`
 * (recorded at createBatch time) is the ACTUAL wire date. When omitted,
 * `IntercoSettlementService.approveBatch` falls back to `batch.transferDate`.
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §7
 */
export class ApproveBatchDto {
  @IsOptional()
  @IsDateString({}, { message: 'วันที่ลงบัญชีไม่ถูกต้อง' })
  postedAt?: string;
}
