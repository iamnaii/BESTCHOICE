import { ConflictException } from '@nestjs/common';
import {
  BLACKLIST_ERROR_CODE,
  canOverrideBlacklist,
  isValidBlacklistOverrideReason,
  type CustomerBlacklistResult,
} from '@installment/shared';

/**
 * ก้อน 5 C3 — ด่าน blacklist (ฟังก์ชันบริสุทธิ์) ใช้สองจุด:
 *  - CREATE  (ContractLifecycleService.create)   — SOFT ปลดได้โดย OWNER/BM พร้อมเหตุผล 10–500 ตัว → คืนเหตุผลที่ trim ให้ caller เขียนลงสัญญา
 *  - ACTIVATE (ContractWorkflowService.activate) — SOFT ผ่านเฉพาะเมื่อร่างมีการปลดบันทึกไว้แล้ว (blacklistOverriddenAt)
 * HARD = 409 ทุกกรณี ไม่มีใครปลด (รวม OWNER) — คำตัดสินเจ้าของ 2026-10-23
 */
export const BLACKLIST_HARD_MSG = 'ลูกค้าติด blacklist ไม่สามารถทำสัญญาได้';
export const BLACKLIST_REVIEW_MSG = 'ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา';
export const BLACKLIST_REVIEW_AT_ACTIVATE_MSG =
  'ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติ (เกิดหลังสร้างร่าง) — ให้ OWNER/ผู้จัดการสาขาลบร่างนี้แล้วสร้างสัญญาใหม่พร้อมอนุมัติ';

export interface BlacklistGateInput {
  result: CustomerBlacklistResult;
  actorRole: string;
  stage: 'CREATE' | 'ACTIVATE';
  /** เหตุผลปลด SOFT ที่ส่งมากับคำขอสร้างร่าง (CREATE เท่านั้น) */
  overrideReason?: string | null;
  /** ร่างนี้ถูกปลด SOFT ไว้แล้วตอนสร้าง (ACTIVATE เท่านั้น — อ่านจาก Contract.blacklistOverriddenAt) */
  persistedOverride?: boolean;
}

/** คืนเหตุผลที่ trim แล้วเมื่อ CREATE+SOFT+ปลดได้ · null เมื่อผ่านโดยไม่ต้องปลด · โยน ConflictException เมื่อห้าม */
export function assertBlacklistGate(input: BlacklistGateInput): string | null {
  const { result, actorRole, stage } = input;
  if (result.level === 'NONE') return null;
  if (result.level === 'HARD') {
    throw new ConflictException({ code: BLACKLIST_ERROR_CODE.HARD, level: 'HARD', reasons: result.reasons, message: BLACKLIST_HARD_MSG });
  }
  if (stage === 'ACTIVATE') {
    if (input.persistedOverride) return null;
    throw new ConflictException({ code: BLACKLIST_ERROR_CODE.SOFT, level: 'SOFT', reasons: result.reasons,
      canOverride: false, message: BLACKLIST_REVIEW_AT_ACTIVATE_MSG });
  }
  const canOverride = canOverrideBlacklist(actorRole);
  if (canOverride && isValidBlacklistOverrideReason(input.overrideReason)) return input.overrideReason.trim();
  throw new ConflictException({ code: BLACKLIST_ERROR_CODE.SOFT, level: 'SOFT', reasons: result.reasons,
    canOverride, message: BLACKLIST_REVIEW_MSG });
}
