import { IsString, MinLength } from 'class-validator';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — เหตุผลย้อนกลับรอบจ่าย (POSTED → REVERSED).
 *
 * Scaffolded here (Task 3) for `reverseBatch` — the method itself lands in
 * Task 4 alongside `approveBatch` (paired JE + drift/period guards). Mirrors
 * `CancelExchangeRequestDto` (contract-exchange module) exactly.
 *
 * Spec: docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md §5, §6
 */
export class ReverseBatchDto {
  @IsString({ message: 'เหตุผลต้องเป็นข้อความ' })
  @MinLength(10, { message: 'เหตุผลย้อนกลับต้องมีอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}
