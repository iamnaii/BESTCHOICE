import { ConflictException } from '@nestjs/common';
import type { CustomerBlacklistResult } from '@installment/shared';
import {
  assertBlacklistGate,
  BLACKLIST_HARD_MSG,
  BLACKLIST_REVIEW_AT_ACTIVATE_MSG,
  BLACKLIST_REVIEW_AT_ACTIVATE_NO_ROLE_MSG,
  BLACKLIST_REVIEW_MSG,
} from './contract-blacklist-gate';

const hard: CustomerBlacklistResult = { level: 'HARD', reasons: [{ code: 'MANUAL_TAG', level: 'HARD', message: 'x' }], checkedAt: 't' };
const soft: CustomerBlacklistResult = { level: 'SOFT', reasons: [{ code: 'REFERENCES_BLACKLISTED', level: 'SOFT', message: 'y' }], checkedAt: 't' };
const none: CustomerBlacklistResult = { level: 'NONE', reasons: [], checkedAt: 't' };
const REASON = 'เหตุผลยาวพอสิบตัว';
const response = (fn: () => unknown) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(ConflictException); return (e as ConflictException).getResponse() as Record<string, unknown>; }
  throw new Error('expected a ConflictException');
};

describe('assertBlacklistGate', () => {
  it('NONE passes and returns null even when a reason is sent', () => {
    expect(assertBlacklistGate({ result: none, actorRole: 'SALES', stage: 'CREATE', overrideReason: REASON })).toBeNull();
    expect(assertBlacklistGate({ result: none, actorRole: 'SYSTEM', stage: 'ACTIVATE' })).toBeNull();
  });

  it.each(['OWNER', 'SALES'])('HARD rejects %s at CREATE and ACTIVATE regardless of reason or persisted override', (role) => {
    for (const stage of ['CREATE', 'ACTIVATE'] as const) {
      const body = response(() => assertBlacklistGate({ result: hard, actorRole: role, stage, overrideReason: REASON, persistedOverride: true }));
      expect(body).toMatchObject({ code: 'CUSTOMER_BLACKLISTED', level: 'HARD', message: BLACKLIST_HARD_MSG, reasons: hard.reasons });
      expect(body).not.toHaveProperty('canOverride');
    }
  });

  it('SOFT at CREATE without reason → REVIEW with canOverride by role', () => {
    expect(response(() => assertBlacklistGate({ result: soft, actorRole: 'OWNER', stage: 'CREATE' })))
      .toMatchObject({ code: 'CUSTOMER_BLACKLIST_REVIEW', level: 'SOFT', canOverride: true, message: BLACKLIST_REVIEW_MSG, reasons: soft.reasons });
    expect(response(() => assertBlacklistGate({ result: soft, actorRole: 'SALES', stage: 'CREATE', overrideReason: REASON })))
      .toMatchObject({ code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: false });
    expect(response(() => assertBlacklistGate({ result: soft, actorRole: 'OWNER', stage: 'CREATE', overrideReason: '  สั้น  ' })))
      .toMatchObject({ code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: true });
  });

  it('SOFT at CREATE with a valid reason by BRANCH_MANAGER returns the trimmed reason', () => {
    expect(assertBlacklistGate({ result: soft, actorRole: 'BRANCH_MANAGER', stage: 'CREATE', overrideReason: '  ลูกค้าเก่าของสาขา ผู้จัดการรับรองเอง  ' }))
      .toBe('ลูกค้าเก่าของสาขา ผู้จัดการรับรองเอง');
  });

  it('SOFT at ACTIVATE passes with a persisted override, or with a fresh OWNER/BM reason (returned trimmed)', () => {
    expect(assertBlacklistGate({ result: soft, actorRole: 'SYSTEM', stage: 'ACTIVATE', persistedOverride: true })).toBeNull();
    expect(assertBlacklistGate({ result: soft, actorRole: 'OWNER', stage: 'ACTIVATE', overrideReason: `  ${REASON}  ` })).toBe(REASON);
    expect(assertBlacklistGate({ result: soft, actorRole: 'BRANCH_MANAGER', stage: 'ACTIVATE', overrideReason: REASON })).toBe(REASON);
  });

  it('SOFT at ACTIVATE without a usable override → REVIEW; canOverride follows the role and the message names the real path', () => {
    expect(response(() => assertBlacklistGate({ result: soft, actorRole: 'OWNER', stage: 'ACTIVATE' })))
      .toMatchObject({ code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: true, message: BLACKLIST_REVIEW_AT_ACTIVATE_MSG });
    expect(response(() => assertBlacklistGate({ result: soft, actorRole: 'FINANCE_MANAGER', stage: 'ACTIVATE', overrideReason: REASON })))
      .toMatchObject({ code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: false, message: BLACKLIST_REVIEW_AT_ACTIVATE_NO_ROLE_MSG });
    expect(BLACKLIST_REVIEW_AT_ACTIVATE_MSG).not.toMatch(/ลบร่าง/);
  });
});
