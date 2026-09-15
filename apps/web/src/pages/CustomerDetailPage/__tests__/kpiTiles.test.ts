import { describe, expect, it } from 'vitest';
import { formatDateShort } from '@/utils/formatters';
import { customerKind } from '../utils/customerKind';
import { kpiTiles } from '../utils/kpiTiles';
import { detail, emptyPurchase, progress } from './fixtures';

// วันที่คำนวณด้วย formatter ตัวเดียวกับหน้าจอเสมอ — CI รันเป็น UTC
const NEXT_DUE = '2026-10-05T00:00:00.000Z';
const WARRANTY = '2026-11-20T00:00:00.000Z';
const LATEST = '2026-08-20T09:05:00.000Z';
const LAST_CONTACT = '2026-09-14T11:40:00.000Z';
const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

const latestPurchase = { at: LATEST, kind: 'CASH' as const, number: 'SL-2569-0210', productLabel: 'iPhone 13 128GB', imeiSerial: null, branchId: null, branchName: null };

describe('customerKind', () => {
  it('มีสัญญาผ่อนที่นับว่าซื้อแล้ว → INSTALLMENT', () => {
    expect(customerKind({ purchase: { ...emptyPurchase, installmentTotal: 1, cashCount: 3 } })).toBe('INSTALLMENT');
  });
  it('มีแต่เงินสด/ไฟแนนซ์นอก → CASH', () => {
    expect(customerKind({ purchase: { ...emptyPurchase, externalFinanceCount: 1 } })).toBe('CASH');
  });
  it('ยังไม่เคยซื้อ หรือ purchase เป็น null → PROSPECT', () => {
    expect(customerKind({ purchase: emptyPurchase })).toBe('PROSPECT');
    expect(customerKind({ purchase: null })).toBe('PROSPECT');
  });
});

describe('kpiTiles', () => {
  it('ลูกค้าผ่อน: การซื้อ · คงค้าง(แดงเมื่อค้าง) · งวดถัดไป · ประกันถึง · แต้มสะสม', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 2, cashCount: 1 },
      installmentBalance: { outstanding: 25200, nextDueDate: NEXT_DUE, nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
      warranty: { endDate: WARRANTY, source: 'SHOP', shopEndDate: WARRANTY, centerEndDate: null, status: 'IN_SHOP_WARRANTY' },
      latestPurchase,
    }), 120);
    expect(tiles.map((t) => t.key)).toEqual(['purchase', 'outstanding', 'nextDue', 'warranty', 'loyalty']);
    expect(tiles[0]).toMatchObject({ label: 'การซื้อ', value: '3 รายการ', sub: 'ผ่อน 2 · เงินสด 1' });
    expect(tiles[1]).toMatchObject({ label: 'คงค้าง', value: baht(25200), sub: `ค้างชำระ 1 งวด · ${baht(4200)}`, tone: 'destructive' });
    expect(tiles[2]).toMatchObject({ label: 'งวดถัดไป', value: formatDateShort(NEXT_DUE), sub: `${baht(4200)} · CT-2569-0042` });
    expect(tiles[3]).toMatchObject({ label: 'ประกันถึง', value: `ร้าน ${formatDateShort(WARRANTY)}`, sub: 'iPhone 13 128GB' });
    expect(tiles[4]).toMatchObject({ label: 'แต้มสะสม', value: '120', tone: 'primary' });
  });

  it('ลูกค้าผ่อนที่ไม่มีงวดค้าง → คงค้างไม่แดง และบอกว่าไม่มีงวดค้าง', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 1 },
      installmentBalance: { outstanding: 8400, nextDueDate: NEXT_DUE, nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress({ overdueInstallments: 0, overdueAmount: 0 })],
    }), 0);
    expect(tiles[1]).toMatchObject({ sub: 'ไม่มีงวดค้าง', tone: 'default' });
    expect(tiles[4]).toMatchObject({ value: '0', tone: 'default' });
  });

  it('สัญญาที่ยังผ่อนไม่มีงวดค้าง แต่มีสัญญาตัดหนี้สูญที่ยังมียอด → คงค้างแดงและบอกว่าหนี้สูญ (กฎเดียวกับ OutstandingCell)', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 1, installmentByState: { ...emptyPurchase.installmentByState, BAD_DEBT: 1 } },
      installmentBalance: { outstanding: 18000, nextDueDate: null, nextAmountDue: null, openContracts: 0 },
      openContracts: [],
    }), 0);
    expect(tiles[1]).toMatchObject({ label: 'คงค้าง', value: baht(18000), sub: `ตัดหนี้สูญ ${baht(18000)}`, tone: 'destructive' });
  });

  it('มีงวดค้างในสัญญาที่ยังผ่อน → ข้อความค้างชำระชนะหนี้สูญ', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 2, installmentByState: { ...emptyPurchase.installmentByState, OVERDUE: 1, BAD_DEBT: 1 } },
      installmentBalance: { outstanding: 43200, nextDueDate: NEXT_DUE, nextAmountDue: 4200, openContracts: 1 },
      openContracts: [progress()],
    }), 0);
    expect(tiles[1]).toMatchObject({ sub: `ค้างชำระ 1 งวด · ${baht(4200)}`, tone: 'destructive' });
  });

  it('หนี้สูญแต่ยอดคงค้างเป็น 0 → ไม่มีงวดค้าง ไม่แดง', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 1, installmentByState: { ...emptyPurchase.installmentByState, BAD_DEBT: 1 } },
      installmentBalance: { outstanding: 0, nextDueDate: null, nextAmountDue: null, openContracts: 0 },
      openContracts: [],
    }), 0);
    expect(tiles[1]).toMatchObject({ sub: 'ไม่มีงวดค้าง', tone: 'default' });
  });

  it('สัญญาเปิด 2 ใบ → งวดถัดไปเลือกวันครบกำหนดที่ใกล้สุด พร้อมยอดและเลขสัญญาของใบนั้น', () => {
    const EARLIER = '2026-09-25T00:00:00.000Z';
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, installmentTotal: 2 },
      installmentBalance: { outstanding: 40000, nextDueDate: EARLIER, nextAmountDue: 3100, openContracts: 2 },
      openContracts: [
        progress({ id: 'k1', contractNumber: 'CT-LATER', overdueInstallments: 0, overdueAmount: 0, nextDueDate: NEXT_DUE, nextAmountDue: 4200 }),
        progress({ id: 'k2', contractNumber: 'CT-EARLIER', overdueInstallments: 0, overdueAmount: 0, nextDueDate: EARLIER, nextAmountDue: 3100 }),
      ],
    }), 0);
    expect(tiles[2]).toMatchObject({ label: 'งวดถัดไป', value: formatDateShort(EARLIER), sub: `${baht(3100)} · CT-EARLIER` });
  });

  it('ลูกค้าเงินสด/ไฟแนนซ์นอก: การซื้อ · ยอดซื้อรวม · ซื้อล่าสุด · ประกันถึง · แต้มสะสม', () => {
    const tiles = kpiTiles(detail({
      purchase: { ...emptyPurchase, cashCount: 1, externalFinanceCount: 1 },
      sales: [
        { id: 's1', saleNumber: 'SL-1', saleType: 'CASH', netAmount: '590.00', createdAt: LATEST, shopWarrantyEndDate: null, product: null, branch: null },
        { id: 's2', saleNumber: 'SL-2', saleType: 'EXTERNAL_FINANCE', netAmount: '29900.00', createdAt: LATEST, shopWarrantyEndDate: null, product: null, branch: null },
      ],
      latestPurchase,
      warranty: { endDate: WARRANTY, source: 'CENTER', shopEndDate: null, centerEndDate: WARRANTY, status: 'IN_MANUFACTURER' },
    }), null);
    expect(tiles.map((t) => t.key)).toEqual(['purchase', 'salesTotal', 'latest', 'warranty', 'loyalty']);
    expect(tiles[0]).toMatchObject({ value: '2 รายการ', sub: 'เงินสด 1 · ไฟแนนซ์นอก 1' });
    expect(tiles[1]).toMatchObject({ label: 'ยอดซื้อรวม', value: baht(30490) });
    expect(tiles[2]).toMatchObject({ label: 'ซื้อล่าสุด', value: formatDateShort(LATEST), sub: 'iPhone 13 128GB' });
    expect(tiles[3]).toMatchObject({ value: `ศูนย์ ${formatDateShort(WARRANTY)}` });
  });

  it('ผู้สนใจ: 4 ช่อง ที่มา · ติดต่อล่าสุด · ผู้ดูแล · เครดิต', () => {
    const tiles = kpiTiles(detail({
      phone: null, chatPlaceholder: true, source: 'FACEBOOK', creditCheckStatus: 'FULL_CHECK_PASSED',
      lastContactAt: LAST_CONTACT, assignedTo: { id: 'u2', name: 'แนน' },
    }), null);
    expect(tiles.map((t) => t.key)).toEqual(['source', 'lastContact', 'owner', 'credit']);
    expect(tiles[0]).toMatchObject({ label: 'ที่มา', value: 'แชท Facebook', sub: 'ยังไม่มีเบอร์' });
    expect(tiles[1]).toMatchObject({ label: 'ติดต่อล่าสุด', value: formatDateShort(LAST_CONTACT) });
    expect(tiles[2]).toMatchObject({ label: 'ผู้ดูแล', value: 'แนน' });
    expect(tiles[3]).toMatchObject({ label: 'เครดิต', value: 'ผ่านเต็ม', tone: 'success' });
  });

  it('ผู้สนใจที่ยังไม่มีข้อมูล → ขีด · ยังไม่มีผู้ดูแล · ยังไม่เคยตรวจ', () => {
    const tiles = kpiTiles(detail(), null);
    expect(tiles[1].value).toBe('—');
    expect(tiles[2].value).toBe('ยังไม่มีผู้ดูแล');
    expect(tiles[3]).toMatchObject({ value: 'ยังไม่เคยตรวจ', tone: 'default' });
  });
});
