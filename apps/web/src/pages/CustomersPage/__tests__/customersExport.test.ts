import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCustomers } from '../utils/customersExport';
import type { CustomerRow, ProspectRow } from '../types';

/**
 * แถวที่ส่งเข้า `exportToExcel` ของปุ่มส่งออกหน้า /customers
 *
 * ผู้สนใจอัตโนมัติจากแชทยังไม่มีเบอร์ (`Customer.phone = null` — สเปค 2026-09-13)
 * ⇒ ช่องเบอร์ต้องเป็น "-" เหมือนช่องว่างอื่นของไฟล์ ไม่ใช่เซลล์ว่างที่ดูเหมือนข้อมูลหาย
 *
 * 🔴 hook ของ vitest ห้าม return ค่า (mockReset คืนฟังก์ชัน → ถูกเรียกเป็น teardown)
 */

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  exportToExcel: vi.fn(),
  toastLoading: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'ส่งออกไม่สำเร็จ',
}));
vi.mock('@/utils/excel.util', () => ({ exportToExcel: mocks.exportToExcel }));
vi.mock('sonner', () => ({
  toast: { loading: mocks.toastLoading, success: mocks.toastSuccess, error: mocks.toastError },
}));

const ISO_AS_OF = '2026-09-15T03:00:00.000Z';
const ISO_CREATED = '2026-09-01T03:00:00.000Z';
const FLAGS = { isOwnerOrManager: false, canViewSalary: false };

function customerRow(overrides: Partial<CustomerRow>): CustomerRow {
  return {
    id: 'c1',
    name: 'สมชาย ผ่อนดี',
    nickname: null,
    phone: '0810000001',
    nationalId: '1234567890123',
    occupation: null,
    salary: null,
    createdAt: ISO_CREATED,
    _count: { contracts: 0 },
    activeContracts: 0,
    overdueContracts: 0,
    latestCreditStatus: null,
    latestCreditScore: null,
    ...overrides,
  };
}

function prospectRow(overrides: Partial<ProspectRow>): ProspectRow {
  return {
    id: 'p1',
    name: 'ผู้สนใจ หนึ่ง',
    nickname: null,
    phone: '0820000001',
    nationalId: '9876543210123',
    createdAt: ISO_CREATED,
    source: null,
    acquisitionSourceRaw: null,
    tags: [],
    creditCheckStatus: 'NONE',
    latestCreditScore: null,
    lastContactAt: null,
    lastContactSource: null,
    assignedTo: null,
    ...overrides,
  };
}

function respondWith(rows: { id: string }[]) {
  mocks.get.mockResolvedValue({ data: { data: rows, total: rows.length, asOf: ISO_AS_OF } });
}

/** แถวข้อมูลที่ส่งเข้า exportToExcel ครั้งล่าสุด */
function exportedRows(): Record<string, unknown>[] {
  const calls = mocks.exportToExcel.mock.calls;
  return (calls[calls.length - 1]?.[0]?.data ?? []) as Record<string, unknown>[];
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.exportToExcel.mockReset();
  mocks.exportToExcel.mockResolvedValue(undefined);
  mocks.toastLoading.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

describe('ส่งออก Excel — ช่องเบอร์โทรว่าง', () => {
  it('แท็บลูกค้า: เบอร์ว่างเป็น "-" ส่วนแถวที่มีเบอร์คงเบอร์เดิม', async () => {
    respondWith([
      customerRow({ id: 'c1', phone: '0810000001' }),
      customerRow({ id: 'c2', name: 'ผู้สนใจ จากแชท', phone: null }),
    ]);
    await exportCustomers({ view: 'customers', params: { view: 'customers' }, flags: FLAGS });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.exportToExcel).toHaveBeenCalledTimes(1);
    expect(exportedRows().map((row) => row.phone)).toEqual(['0810000001', '-']);
  });

  it('แท็บผู้สนใจ: เบอร์ว่างเป็น "-" ส่วนแถวที่มีเบอร์คงเบอร์เดิม', async () => {
    respondWith([
      prospectRow({ id: 'p1', phone: '0820000001' }),
      prospectRow({ id: 'p2', name: 'ผู้สนใจ จากแชท', phone: null }),
    ]);
    await exportCustomers({ view: 'prospects', params: { view: 'prospects' }, flags: FLAGS });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.exportToExcel).toHaveBeenCalledTimes(1);
    expect(exportedRows().map((row) => row.phone)).toEqual(['0820000001', '-']);
  });
});

// M-W8: `Customer.nationalId` เป็น nullable (ผู้สนใจจากแชท / ลูกค้าที่ยังไม่เคยให้บัตร)
// ⇒ คอลัมน์เลขบัตร (เจ้าของ/ผู้จัดการเท่านั้น) ต้องเป็น "-" เหมือนเบอร์ ไม่ใช่เซลล์ว่าง
describe('ส่งออก Excel — ช่องเลขบัตรว่าง (เจ้าของ/ผู้จัดการ)', () => {
  const OWNER_FLAGS = { isOwnerOrManager: true, canViewSalary: false };

  it('แท็บลูกค้า: เลขบัตรว่างเป็น "-" ส่วนแถวที่มีเลขบัตรคงเลขเดิม', async () => {
    respondWith([
      customerRow({ id: 'c1', nationalId: '1234567890123' }),
      customerRow({ id: 'c2', nationalId: null }),
    ]);
    await exportCustomers({ view: 'customers', params: { view: 'customers' }, flags: OWNER_FLAGS });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(exportedRows().map((row) => row.nationalId)).toEqual(['1234567890123', '-']);
  });

  it('แท็บผู้สนใจ: เลขบัตรว่างเป็น "-" ส่วนแถวที่มีเลขบัตรคงเลขเดิม', async () => {
    respondWith([
      prospectRow({ id: 'p1', nationalId: '9876543210123' }),
      prospectRow({ id: 'p2', nationalId: null }),
    ]);
    await exportCustomers({ view: 'prospects', params: { view: 'prospects' }, flags: OWNER_FLAGS });

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(exportedRows().map((row) => row.nationalId)).toEqual(['9876543210123', '-']);
  });

  it('ไม่ใช่เจ้าของ/ผู้จัดการ → ไม่มีคีย์เลขบัตรในแถวเลย (ไม่ใช่ "-")', async () => {
    respondWith([prospectRow({ id: 'p2', nationalId: null })]);
    await exportCustomers({ view: 'prospects', params: { view: 'prospects' }, flags: FLAGS });

    expect(exportedRows()[0]).not.toHaveProperty('nationalId');
  });
});
