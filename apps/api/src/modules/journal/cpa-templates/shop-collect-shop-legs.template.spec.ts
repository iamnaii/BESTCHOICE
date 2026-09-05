import { describe, it, expect, vi } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import {
  ShopCollectShopLegs,
  SHOP_COLLECT_SETTLEMENT_SHOP_FLOW,
  SHOP_REPOSSESSION_INTAKE_FLOW,
} from './shop-collect-shop-legs.template';

/**
 * ขาคู่ฝั่ง SHOP ของ 11-2107 SHOP_COLLECT ต้นทาง JP5 (คำตัดสินเจ้าของ 2026-09-05).
 * Runner: vitest — ไฟล์ใต้ cpa-templates/ ถูก jest ignore (testPathIgnorePatterns) และ CI รันด้วย vitest glob
 * `src/modules/journal/cpa-templates/*.spec.ts` เหมือน template spec เพื่อนบ้าน.
 * Locks: บัญชี/ทิศ/ยอด, stamp SHOP_COLLECT เฉพาะเคสค้างจ่าย, idempotency key, companyId SHOP.
 */
describe('ShopCollectShopLegs', () => {
  const build = () => {
    const createAndPost = vi.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202609-00001' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legs = new ShopCollectShopLegs({ createAndPost } as any);
    return { legs, createAndPost };
  };
  const lineTuples = (input: { lines: Array<{ accountCode: string; dr: Decimal; cr: Decimal }> }) =>
    input.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)]);

  describe('postRepossessionIntake', () => {
    it('collectedByShop → Dr S11-2002 / Cr S21-1104 stamped SHOP_COLLECT + contractId', async () => {
      const { legs, createAndPost } = build();
      await legs.postRepossessionIntake({
        contractId: 'c-1',
        contractNumber: 'TEST-001',
        productId: 'p-1',
        appraisal: new Decimal('6500'),
        collectedByShop: true,
        shopCompanyId: 'shop-co',
        postedAt: new Date('2026-09-05T00:00:00Z'),
      });
      const input = createAndPost.mock.calls[0][0];
      expect(lineTuples(input)).toEqual([
        ['S11-2002', '6500.00', '0.00'],
        ['S21-1104', '0.00', '6500.00'],
      ]);
      expect(input.companyId).toBe('shop-co');
      expect(input.postedAt).toEqual(new Date('2026-09-05T00:00:00Z'));
      expect(input.metadata).toMatchObject({
        flow: SHOP_REPOSSESSION_INTAKE_FLOW,
        idempotencyKey: `${SHOP_REPOSSESSION_INTAKE_FLOW}:c-1`,
        contractId: 'c-1',
        productId: 'p-1',
        companyCode: 'SHOP',
        shopReceivableType: 'SHOP_COLLECT',
        collectedByShop: true,
        appraisal: '6500.00',
      });
      expect(input.reference).toBe('contract:c-1:repossession-intake');
    });

    it('paid to FINANCE immediately → Cr S11-1202 (SHOP paying bank) and NO shopReceivableType stamp', async () => {
      const { legs, createAndPost } = build();
      await legs.postRepossessionIntake({
        contractId: 'c-1',
        contractNumber: 'TEST-001',
        productId: 'p-1',
        appraisal: new Decimal('6500'),
        collectedByShop: false,
        shopCompanyId: 'shop-co',
      });
      const input = createAndPost.mock.calls[0][0];
      expect(lineTuples(input)).toEqual([
        ['S11-2002', '6500.00', '0.00'],
        ['S11-1202', '0.00', '6500.00'],
      ]);
      expect(input.metadata.shopReceivableType).toBeUndefined();
    });

    it('rejects a non-positive appraisal (programmer error, not a business path)', async () => {
      const { legs } = build();
      await expect(
        legs.postRepossessionIntake({
          contractId: 'c-1',
          contractNumber: 'TEST-001',
          productId: 'p-1',
          appraisal: new Decimal('0'),
          collectedByShop: true,
          shopCompanyId: 'shop-co',
        }),
      ).rejects.toThrow(/appraisal must be > 0/);
    });
  });

  describe('postSettlement', () => {
    it('Dr S21-1104 / Cr S11-1202 keyed by requestId, stamped SHOP_COLLECT', async () => {
      const { legs, createAndPost } = build();
      await legs.postSettlement({
        contractId: 'c-1',
        amount: new Decimal('6500'),
        shopCompanyId: 'shop-co',
        requestId: 'req-1',
      });
      const input = createAndPost.mock.calls[0][0];
      expect(lineTuples(input)).toEqual([
        ['S21-1104', '6500.00', '0.00'],
        ['S11-1202', '0.00', '6500.00'],
      ]);
      expect(input.metadata).toMatchObject({
        flow: SHOP_COLLECT_SETTLEMENT_SHOP_FLOW,
        idempotencyKey: `${SHOP_COLLECT_SETTLEMENT_SHOP_FLOW}:c-1:req-1`,
        contractId: 'c-1',
        shopReceivableType: 'SHOP_COLLECT',
        requestId: 'req-1',
        amount: '6500.00',
      });
      expect(input.reference).toBe('contract:c-1:shop-collect-settlement-shop:req-1');
    });

    it('falls back to the 2dp amount as the key when no requestId is given (legacy caller shape)', async () => {
      const { legs, createAndPost } = build();
      await legs.postSettlement({
        contractId: 'c-1',
        amount: new Decimal('1234.5'),
        shopCompanyId: 'shop-co',
      });
      const input = createAndPost.mock.calls[0][0];
      expect(input.metadata.idempotencyKey).toBe(
        `${SHOP_COLLECT_SETTLEMENT_SHOP_FLOW}:c-1:1234.50`,
      );
      expect(input.metadata.requestId).toBeUndefined();
    });
  });
});
