import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExchangeCard from './ExchangeCard';
import type { CaseDetail } from './after-sales';

/** ฟิกซ์เจอร์ขั้นต่ำของ CaseDetail สำหรับเทสต์ ExchangeCard (Task 11 fix round 1, P-M.1) —
 * เฉพาะฟิลด์ที่ ExchangeCard อ่าน (`exchange`, `warrantySnapshot`) ใส่ค่าจริง ที่เหลือใส่
 * ค่าคงที่ให้ผ่าน type เท่านั้น */
function detail(over: Partial<CaseDetail> = {}): CaseDetail {
  const base: CaseDetail = {
    id: 'case-1',
    caseNumber: 'AS-20260922-0001',
    source: 'INSTALLMENT_CONTRACT',
    outcome: 'SAME_MODEL_EXCHANGE',
    stage: 'AWAITING_APPROVAL',
    stale: false,
    daysInStage: 0,
    receivedAt: '2026-09-01T00:00:00.000Z',
    deviceBrand: 'Samsung',
    deviceModel: 'A55',
    deviceImei: '356800000000001',
    customer: { id: 'cust-1', name: 'ธนา พงศ์ไพศาล', phone: '0812345678' },
    branch: { id: 'branch-1', name: 'ลพบุรี' },
    receivedBy: { id: 'user-1', name: 'นิภา' },
    repairTicket: null,
    exchange: {
      kind: 'SAME_MODEL',
      mode: null,
      approvalTier: null,
      requestStatus: null,
      buybackPrice: null,
      ncvSnapshot: null,
      approverRole: 'BRANCH_MANAGER',
      oldProduct: { brand: 'Samsung', model: 'A55', storage: '128GB', imeiSerial: '3542...1188' },
      newProduct: {
        id: 'prod-2',
        brand: 'Samsung',
        model: 'A55',
        storage: '128GB',
        imeiSerial: '3542...2260',
      },
      replacementContract: null,
      requestedBy: { id: 'u1', name: 'นิภา' },
    },
    symptom: 'ลำโพงไม่ดัง',
    accessories: {},
    unlockConfirmed: true,
    warrantySnapshot: {
      status: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 3,
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
      checkedAt: '2026-09-01T00:00:00.000Z',
    },
    photoCount: 6,
    purchasePhotoAngles: [],
    lineLinked: false,
    timeline: [],
    cancelReason: null,
    closedAt: null,
    contractId: 'contract-1',
    saleId: null,
    replacementProductId: null,
    replacementContractId: null,
  };
  return { ...base, ...over };
}

describe('ExchangeCard — P-M.1 (fix round 1): ป้าย 7 วันใช้สแนปช็อตจริง ไม่ประมาณเอง', () => {
  it('daysRemainingIn7Day > 0 → "อยู่ในกรอบ 7 วัน · เหลือ N วัน" ด้วยค่าจริงจาก API', () => {
    const detailData = detail({
      warrantySnapshot: {
        status: 'IN_7DAY_DEFECT',
        daysRemainingIn7Day: 3,
        shopWarrantyEndDate: null,
        manufacturerWarrantyEndDate: null,
        checkedAt: '2026-09-01T00:00:00.000Z',
      },
    });
    render(<ExchangeCard data={detailData} />);
    expect(screen.getByText('อยู่ในกรอบ 7 วัน · เหลือ 3 วัน')).toBeInTheDocument();
    expect(screen.queryByText(/พ้นกรอบ/)).not.toBeInTheDocument();
  });

  it('daysRemainingIn7Day = 0 (หมดกรอบพอดี) → "พ้นกรอบ 7 วัน — ผจก. ยืนยันได้"', () => {
    const detailData = detail({
      warrantySnapshot: {
        status: 'OUT_OF_WARRANTY',
        daysRemainingIn7Day: 0,
        shopWarrantyEndDate: null,
        manufacturerWarrantyEndDate: null,
        checkedAt: '2026-09-01T00:00:00.000Z',
      },
    });
    render(<ExchangeCard data={detailData} />);
    expect(screen.getByText('พ้นกรอบ 7 วัน — ผจก. ยืนยันได้')).toBeInTheDocument();
    expect(screen.queryByText(/อยู่ในกรอบ 7 วัน · เหลือ/)).not.toBeInTheDocument();
  });

  it('REPAIR-origin case ยืนยันผ่าน bypass นอกกรอบ 7 วัน (outcome เปลี่ยนเป็น SAME_MODEL_EXCHANGE แล้ว แต่ warrantySnapshot ยังบอกพ้นกรอบ) → ไม่อ้าง "อยู่ในกรอบ" อีกต่อไป', () => {
    const detailData = detail({
      warrantySnapshot: {
        status: 'OUT_OF_WARRANTY',
        daysRemainingIn7Day: -5,
        shopWarrantyEndDate: null,
        manufacturerWarrantyEndDate: null,
        checkedAt: '2026-09-01T00:00:00.000Z',
      },
    });
    render(<ExchangeCard data={detailData} />);
    expect(screen.getByText('พ้นกรอบ 7 วัน — ผจก. ยืนยันได้')).toBeInTheDocument();
  });

  it('ไม่มี daysRemainingIn7Day เป็นตัวเลขจริง (backfilled shape) → ถือว่าพ้นกรอบ (fail-safe)', () => {
    const detailData = detail({
      warrantySnapshot: {
        status: 'IN_7DAY_DEFECT',
        checkedAt: '2026-09-01T00:00:00.000Z',
      } as never,
    });
    render(<ExchangeCard data={detailData} />);
    expect(screen.getByText('พ้นกรอบ 7 วัน — ผจก. ยืนยันได้')).toBeInTheDocument();
  });
});
