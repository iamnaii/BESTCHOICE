import { describe, expect, it } from 'vitest';
import {
  STAGE_LABEL,
  STAGE_ICON,
  STAGE_TILE,
  SOURCE_LABEL,
  OUTCOME_LABEL,
  WARRANTY_LABEL,
  WARRANTY_TILE,
  WARRANTY_STATUSES,
  staleLabel,
  EXCHANGE_KIND_LABEL,
  APPROVER_LABEL,
  TIER_LABEL,
  STEP_TITLES_BY_OUTCOME,
  stageIndex,
  afterSalesKeys,
  primaryAction,
  secondaryActions,
  type AfterSalesOutcome,
  type CaseDetail,
} from './after-sales';

const ALL_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT'];

/** ฟิกซ์เจอร์ขั้นต่ำของ CaseDetail สำหรับตาราง primaryAction/secondaryActions (Task 11) —
 * ฟิลด์ที่ primaryAction/secondaryActions ไม่อ่านเลยใส่ค่าคงที่ไปเพื่อให้ผ่าน type เท่านั้น */
function detail(over: Partial<CaseDetail> = {}): CaseDetail {
  const base: CaseDetail = {
    id: 'case-1',
    caseNumber: 'AS-20260922-0001',
    source: 'INSTALLMENT_CONTRACT',
    outcome: 'REPAIR',
    stage: 'RECEIVED',
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
    exchange: null,
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

/** ฟิกซ์เจอร์ repairTicket ขั้นต่ำของ CaseDetail (มี externalClaimNo/expenseDocument/otherIncome
 * ที่ CaseRow ไม่มี — เพิ่มเฉพาะที่นี่กันพิมพ์ซ้ำทุกเทสต์) */
function rt(over: Partial<NonNullable<CaseDetail['repairTicket']>> = {}) {
  return {
    id: 'rt-1',
    ticketNumber: 'RT-1',
    status: 'OPEN',
    payer: 'SHOP' as const,
    estimatedCost: null,
    actualCost: null,
    sentToRepairAt: null,
    repairedAt: null,
    externalClaimNo: null,
    repairSupplier: null,
    expenseDocument: null,
    otherIncome: null,
    ...over,
  };
}

const ALL_OUTCOMES: AfterSalesOutcome[] = [
  'REPAIR',
  'SAME_MODEL_EXCHANGE',
  'PRICED_EXCHANGE',
  'CASH_SAME_MODEL_EXCHANGE',
];
describe('after-sales maps', () => {
  it('ทุก stage มีป้าย+ไอคอน+สี (สถานะห้ามบอกด้วยสีอย่างเดียว)', () => {
    for (const s of [
      'RECEIVED',
      'IN_REPAIR',
      'AWAITING_APPROVAL',
      'READY_FOR_PICKUP',
      'CLOSED',
      'CANCELLED',
    ] as const) {
      expect(STAGE_LABEL[s]).toBeTruthy();
      expect(STAGE_ICON[s]).toBeTruthy();
      expect(STAGE_TILE[s]).toMatch(/border-|bg-/);
    }
    expect(STAGE_LABEL.RECEIVED).toBe('รับเรื่องแล้ว');
    expect(SOURCE_LABEL.WALK_IN).toBe('ไม่ได้ซื้อจากร้าน');
    expect(OUTCOME_LABEL.REPAIR).toBe('ซ่อม');
  });
  it('staleLabel บอกจำนวนวันตาม stage (R25 e — เลิกคำว่า "เกิน" ที่ขอบ)', () => {
    expect(staleLabel('IN_REPAIR', 14)).toBe('ส่งศูนย์ 14 วัน (เกณฑ์ 14 วัน)');
    expect(staleLabel('IN_REPAIR', 16)).toBe('ส่งศูนย์ 16 วัน (เกณฑ์ 14 วัน)');
    expect(staleLabel('READY_FOR_PICKUP', 3)).toBeNull();
  });

  // C3 (final-fix brief) — API `isStale` เทียบเป็นมิลลิวินาที (`ms > d*86400000`) แต่
  // `daysInStage` ที่ส่งมาคือ `Math.floor(ms/86400000)` — เคส 14.5 วันจริง: floor = 14 แต่
  // API ถือว่า stale แล้ว (14.5*day > 14*day) ก่อนแก้ `days > s[0]` (14 > 14 = false) จะไม่โชว์
  // ข้อความค้างนานทั้งที่ API บอกว่า stale — ต้องให้ boundary ตรงกัน (`days >= s[0]`)
  it('C3: ขอบ 14.5 วันจริง (floor เหลือ 14) ต้องยังโชว์ข้อความค้างนาน ให้ตรง semantics ของ API isStale', () => {
    // จำลอง daysInStage ที่ API จะส่งมาจริงสำหรับเคส IN_REPAIR ที่ผ่านมา 14.5 วัน:
    // ms = 14.5 * 86400000 → isStale (ms > 14*86400000) = true, floor(ms/86400000) = 14
    const daysInStageFromApi = Math.floor((14.5 * 86400000) / 86400000);
    expect(daysInStageFromApi).toBe(14);
    expect(staleLabel('IN_REPAIR', daysInStageFromApi)).toBe('ส่งศูนย์ 14 วัน (เกณฑ์ 14 วัน)');
  });
  it('ทุก WarrantyStatus มีป้าย+โทเคนสี (WARRANTY_LABEL/WARRANTY_TILE ใช้ร่วมกันทั้ง IntakeBox และ AfterSalesNewPage)', () => {
    for (const status of WARRANTY_STATUSES) {
      expect(WARRANTY_LABEL[status]).toBeTruthy();
      expect(WARRANTY_TILE[status]).toMatch(/border-|bg-/);
    }
  });

  it('Task 9: EXCHANGE_KIND_LABEL / APPROVER_LABEL / TIER_LABEL ตรงคำเป๊ะ', () => {
    expect(EXCHANGE_KIND_LABEL).toEqual({ SAME_MODEL: 'รุ่นเดิม · 7 วัน', PRICED: 'มีราคา' });
    expect(APPROVER_LABEL).toEqual({ BRANCH_MANAGER: 'ผจก.สาขา', OWNER: 'เจ้าของเท่านั้น' });
    expect(TIER_LABEL).toEqual({ AUTO: 'อัตโนมัติ', REVIEW: 'REVIEW', ESCALATE: 'ESCALATE' });
  });

  it('Task 9: STEP_TITLES_BY_OUTCOME ครบทุก outcome — 4 ขั้นเป๊ะ ไม่มีเลขนำหน้า และไม่มีคำว่า "รับเครื่อง"', () => {
    for (const outcome of ALL_OUTCOMES) {
      const titles = STEP_TITLES_BY_OUTCOME[outcome];
      expect(titles).toHaveLength(4);
      for (const title of titles) {
        expect(title).not.toMatch(/\d/);
        expect(title).not.toContain('รับเครื่อง');
      }
    }
    expect(STEP_TITLES_BY_OUTCOME.REPAIR).toEqual([
      'รับเรื่องแล้ว',
      'กำลังซ่อม',
      'รอลูกค้ารับ',
      'ปิดเคส',
    ]);
    expect(STEP_TITLES_BY_OUTCOME.SAME_MODEL_EXCHANGE).toEqual([
      'รับเรื่องแล้ว',
      'รอ ผจก. ยืนยัน',
      'ส่งมอบเครื่องใหม่',
      'ปิดเคส',
    ]);
    expect(STEP_TITLES_BY_OUTCOME.CASH_SAME_MODEL_EXCHANGE).toEqual(
      STEP_TITLES_BY_OUTCOME.SAME_MODEL_EXCHANGE,
    );
    expect(STEP_TITLES_BY_OUTCOME.PRICED_EXCHANGE).toEqual([
      'รับเรื่องแล้ว',
      'รออนุมัติ',
      'สัญญาใหม่',
      'ปิดเคส',
    ]);
  });

  it('Task 9: stageIndex map ตำแหน่งขั้น 0..3 · CANCELLED = idle ทั้งหมด (-1)', () => {
    expect(stageIndex('RECEIVED')).toBe(0);
    expect(stageIndex('IN_REPAIR')).toBe(1);
    expect(stageIndex('AWAITING_APPROVAL')).toBe(1);
    expect(stageIndex('READY_FOR_PICKUP')).toBe(2);
    expect(stageIndex('CLOSED')).toBe(3);
    expect(stageIndex('CANCELLED')).toBe(-1);
  });

  it('Task 9: afterSalesKeys.preview/replacementProducts เป็นคีย์แยกจาก list/case', () => {
    expect(afterSalesKeys.preview({ contractId: 'c1' })).toEqual([
      'after-sales',
      'preview',
      { contractId: 'c1' },
    ]);
    expect(afterSalesKeys.replacementProducts({ contractId: 'c1' })).toEqual([
      'after-sales',
      'replacement-products',
      { contractId: 'c1' },
    ]);
  });
});

describe('Task 11: primaryAction — ปุ่มหลักตาม outcome × stage × role', () => {
  it('REPAIR RECEIVED ไม่มีศูนย์ (repairTicket.repairSupplier=null) → STAFF ทุกคนได้ "บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)"; FM/ACCOUNTANT ไม่มีอะไร', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'RECEIVED',
      repairTicket: rt({ status: 'OPEN', repairSupplier: null }),
    });
    for (const role of ['OWNER', 'BRANCH_MANAGER', 'SALES']) {
      expect(primaryAction(d, role)).toEqual({
        label: 'บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)',
        dialog: 'mark-repaired',
      });
    }
    for (const role of ['FINANCE_MANAGER', 'ACCOUNTANT']) {
      expect(primaryAction(d, role)).toBeNull();
    }
  });

  it('REPAIR RECEIVED มีศูนย์ (repairTicket.repairSupplier ตั้งแล้ว) → STAFF ได้ "ส่งซ่อม"', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'RECEIVED',
      repairTicket: rt({ status: 'OPEN', repairSupplier: { id: 'sup-1', name: 'ศูนย์ A' } }),
    });
    for (const role of ['OWNER', 'BRANCH_MANAGER', 'SALES']) {
      expect(primaryAction(d, role)).toEqual({ label: 'ส่งซ่อม', dialog: 'send' });
    }
    expect(primaryAction(d, 'FINANCE_MANAGER')).toBeNull();
  });

  it('REPAIR IN_REPAIR → STAFF ได้ "บันทึกซ่อมเสร็จ" (ไม่มีคำว่า "ซ่อมที่ร้าน")', () => {
    const d = detail({ outcome: 'REPAIR', stage: 'IN_REPAIR' });
    for (const role of ['OWNER', 'BRANCH_MANAGER', 'SALES']) {
      expect(primaryAction(d, role)).toEqual({ label: 'บันทึกซ่อมเสร็จ', dialog: 'mark-repaired' });
    }
    expect(primaryAction(d, 'ACCOUNTANT')).toBeNull();
  });

  it('REPAIR READY_FOR_PICKUP (ticket ไม่ใช่ REPLACED) → STAFF ได้ "ส่งมอบคืนลูกค้า"', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'READY_FOR_PICKUP',
      repairTicket: rt({
        status: 'READY_FOR_PICKUP',
        actualCost: '500.00',
        sentToRepairAt: '2026-09-05T00:00:00.000Z',
        repairedAt: '2026-09-08T00:00:00.000Z',
        repairSupplier: { id: 'sup-1', name: 'ศูนย์ A' },
      }),
    });
    for (const role of ['OWNER', 'BRANCH_MANAGER', 'SALES']) {
      expect(primaryAction(d, role)).toEqual({ label: 'ส่งมอบคืนลูกค้า', dialog: 'return' });
    }
  });

  it('REPAIR READY_FOR_PICKUP แต่ repairTicket.status = REPLACED → ไม่มีปุ่มนี้อีก (แถวส่งมอบเครื่องใหม่แทน แต่ outcome ต้องเป็น SAME_MODEL_EXCHANGE แล้วในทางปฏิบัติ — เคสนี้จำลอง outcome ค้าง REPAIR ไว้เพื่อพิสูจน์ guard)', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'READY_FOR_PICKUP',
      repairTicket: rt({ status: 'REPLACED', repairSupplier: null }),
    });
    expect(primaryAction(d, 'OWNER')).toBeNull();
  });

  it('SAME_MODEL_EXCHANGE READY_FOR_PICKUP + replacementContractId → STAFF ได้ "ส่งมอบเครื่องใหม่"', () => {
    const d = detail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'READY_FOR_PICKUP',
      replacementContractId: 'ct-2',
      exchange: {
        kind: 'SAME_MODEL',
        mode: null,
        approvalTier: null,
        requestStatus: null,
        buybackPrice: null,
        ncvSnapshot: null,
        approverRole: 'BRANCH_MANAGER',
        oldProduct: null,
        newProduct: null,
        replacementContract: { id: 'ct-2', contractNumber: 'CT-2026-0099', status: 'DRAFT' },
        requestedBy: null,
      },
    });
    for (const role of ['OWNER', 'BRANCH_MANAGER', 'SALES']) {
      expect(primaryAction(d, role)).toEqual({
        label: 'ส่งมอบเครื่องใหม่',
        dialog: 'exchange-deliver',
      });
    }
    expect(primaryAction(d, 'FINANCE_MANAGER')).toBeNull();
  });

  it('SAME_MODEL_EXCHANGE AWAITING_APPROVAL → MGR ได้ "ยืนยันเปลี่ยนเครื่อง"; SALES ได้ข้อความรอ; FM/ACCOUNTANT ไม่มีอะไร', () => {
    const d = detail({ outcome: 'SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL' });
    expect(primaryAction(d, 'OWNER')).toEqual({
      label: 'ยืนยันเปลี่ยนเครื่อง',
      dialog: 'exchange-confirm',
    });
    expect(primaryAction(d, 'BRANCH_MANAGER')).toEqual({
      label: 'ยืนยันเปลี่ยนเครื่อง',
      dialog: 'exchange-confirm',
    });
    expect(primaryAction(d, 'SALES')).toEqual({ waitingText: 'รอ ผจก.สาขา ยืนยัน' });
    expect(primaryAction(d, 'FINANCE_MANAGER')).toBeNull();
    expect(primaryAction(d, 'ACCOUNTANT')).toBeNull();
  });

  it('PRICED_EXCHANGE AWAITING_APPROVAL tier REVIEW (approverRole=BRANCH_MANAGER) → OWNER และ BM ได้ "อนุมัติ" ทั้งคู่; SALES ได้ข้อความรอ', () => {
    const d = detail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      exchange: {
        kind: 'PRICED',
        mode: 'PRICED',
        approvalTier: 'REVIEW',
        requestStatus: 'PENDING',
        buybackPrice: '8500.00',
        ncvSnapshot: '10000.00',
        approverRole: 'BRANCH_MANAGER',
        oldProduct: null,
        newProduct: null,
        replacementContract: null,
        requestedBy: null,
      },
    });
    expect(primaryAction(d, 'OWNER')).toEqual({ label: 'อนุมัติ', dialog: 'approve' });
    expect(primaryAction(d, 'BRANCH_MANAGER')).toEqual({ label: 'อนุมัติ', dialog: 'approve' });
    expect(primaryAction(d, 'SALES')).toEqual({ waitingText: 'รอ ผจก.สาขา อนุมัติ' });
  });

  it('PRICED_EXCHANGE AWAITING_APPROVAL tier ESCALATE (approverRole=OWNER) → BM ไม่มีปุ่ม มี "รอ เจ้าของเท่านั้น อนุมัติ"; OWNER ได้ "อนุมัติ"', () => {
    const d = detail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      exchange: {
        kind: 'PRICED',
        mode: 'PRICED',
        approvalTier: 'ESCALATE',
        requestStatus: 'PENDING',
        buybackPrice: '4000.00',
        ncvSnapshot: '10000.00',
        approverRole: 'OWNER',
        oldProduct: null,
        newProduct: null,
        replacementContract: null,
        requestedBy: null,
      },
    });
    expect(primaryAction(d, 'BRANCH_MANAGER')).toEqual({
      waitingText: 'รอ เจ้าของเท่านั้น อนุมัติ',
    });
    expect(primaryAction(d, 'OWNER')).toEqual({ label: 'อนุมัติ', dialog: 'approve' });
    expect(primaryAction(d, 'SALES')).toEqual({ waitingText: 'รอ เจ้าของเท่านั้น อนุมัติ' });
  });

  it('PRICED_EXCHANGE READY_FOR_PICKUP → ไม่มีปุ่มหลัก (ทุก role) — หน้าเพจแสดงลิงก์ "ไปสัญญาใหม่" แทน', () => {
    const d = detail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'READY_FOR_PICKUP',
      replacementContractId: 'ct-3',
      exchange: {
        kind: 'PRICED',
        mode: 'PRICED',
        approvalTier: 'AUTO',
        requestStatus: 'APPROVED',
        buybackPrice: '9000.00',
        ncvSnapshot: '9000.00',
        approverRole: 'BRANCH_MANAGER',
        oldProduct: null,
        newProduct: null,
        replacementContract: { id: 'ct-3', contractNumber: 'CT-2026-0100', status: 'DRAFT' },
        requestedBy: null,
      },
    });
    for (const role of ALL_ROLES) expect(primaryAction(d, role)).toBeNull();
  });

  it('ทุกทาง — CLOSED/CANCELLED ไม่มีปุ่มหลักไม่ว่า role ไหน', () => {
    for (const stage of ['CLOSED', 'CANCELLED'] as const) {
      for (const outcome of ['REPAIR', 'SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE'] as const) {
        const d = detail({ outcome, stage });
        for (const role of ALL_ROLES) expect(primaryAction(d, role)).toBeNull();
      }
    }
  });

  it('CASH_SAME_MODEL_EXCHANGE — ยังไม่มีปุ่มใดๆ (engine ปฏิเสธเมื่อไม่มีสัญญาผ่อน)', () => {
    const d = detail({ outcome: 'CASH_SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL' });
    for (const role of ALL_ROLES) expect(primaryAction(d, role)).toBeNull();
  });
});

describe('Task 11: secondaryActions — ปุ่มรองตาม outcome × stage × role', () => {
  it('REPAIR RECEIVED ไม่มีศูนย์ → รอง: "ส่งซ่อม" (STAFF) · "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" (MGR, สัญญาผ่อน) · "ยกเลิกเคส" (MGR)', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'RECEIVED',
      contractId: 'contract-1',
      repairTicket: rt({ status: 'OPEN', repairSupplier: null }),
    });
    expect(secondaryActions(d, 'OWNER')).toEqual([
      { kind: 'dialog', label: 'ส่งซ่อม', dialog: 'send' },
      { kind: 'dialog', label: 'ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม', dialog: 'exchange-confirm' },
      { kind: 'dialog', label: 'ยกเลิกเคส', dialog: 'cancel', destructive: true },
    ]);
    // SALES ไม่ใช่ MGR → ไม่มี "ซ่อมไม่ได้..." และ "ยกเลิกเคส" เหลือแค่ "ส่งซ่อม"
    expect(secondaryActions(d, 'SALES')).toEqual([
      { kind: 'dialog', label: 'ส่งซ่อม', dialog: 'send' },
    ]);
  });

  it('REPAIR RECEIVED ไม่มีสัญญาผ่อน (contractId=null) → ไม่มี "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" แม้เป็น MGR', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'RECEIVED',
      contractId: null,
      repairTicket: rt({ status: 'OPEN', repairSupplier: null }),
    });
    const actions = secondaryActions(d, 'OWNER');
    expect(actions.some((a) => a.kind === 'dialog' && a.dialog === 'exchange-confirm')).toBe(false);
  });

  it('REPAIR RECEIVED มีศูนย์ → รอง: เหมือนแถวไม่มีศูนย์ลบ "ส่งซ่อม" ออก', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'RECEIVED',
      repairTicket: rt({ status: 'OPEN', repairSupplier: { id: 'sup-1', name: 'ศูนย์ A' } }),
    });
    expect(secondaryActions(d, 'OWNER')).toEqual([
      { kind: 'dialog', label: 'ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม', dialog: 'exchange-confirm' },
      { kind: 'dialog', label: 'ยกเลิกเคส', dialog: 'cancel', destructive: true },
    ]);
  });

  it('REPAIR IN_REPAIR → รอง: เฉพาะ "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" (MGR, สัญญาผ่อน) ไม่มี "ยกเลิกเคส"', () => {
    const d = detail({ outcome: 'REPAIR', stage: 'IN_REPAIR', contractId: 'contract-1' });
    expect(secondaryActions(d, 'BRANCH_MANAGER')).toEqual([
      { kind: 'dialog', label: 'ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม', dialog: 'exchange-confirm' },
    ]);
    expect(secondaryActions(d, 'SALES')).toEqual([]);
  });

  it('REPAIR READY_FOR_PICKUP (ticket ไม่ REPLACED) → รอง: "ส่งซ่อมต่อ" (STAFF) · "ยกเลิกเคส" (MGR)', () => {
    const d = detail({
      outcome: 'REPAIR',
      stage: 'READY_FOR_PICKUP',
      repairTicket: rt({
        status: 'READY_FOR_PICKUP',
        actualCost: '500.00',
        sentToRepairAt: '2026-09-05T00:00:00.000Z',
        repairedAt: '2026-09-08T00:00:00.000Z',
        repairSupplier: { id: 'sup-1', name: 'ศูนย์ A' },
      }),
    });
    expect(secondaryActions(d, 'OWNER')).toEqual([
      { kind: 'dialog', label: 'ส่งซ่อมต่อ', dialog: 'send-back' },
      { kind: 'dialog', label: 'ยกเลิกเคส', dialog: 'cancel', destructive: true },
    ]);
    expect(secondaryActions(d, 'SALES')).toEqual([
      { kind: 'dialog', label: 'ส่งซ่อมต่อ', dialog: 'send-back' },
    ]);
  });

  it('SAME_MODEL_EXCHANGE AWAITING_APPROVAL → รอง: "ปฏิเสธ (ใส่เหตุผล)" (MGR) · "เปลี่ยนเป็น \'ซ่อม\' แทน" (STAFF)', () => {
    const d = detail({ outcome: 'SAME_MODEL_EXCHANGE', stage: 'AWAITING_APPROVAL' });
    expect(secondaryActions(d, 'OWNER')).toEqual([
      { kind: 'dialog', label: 'ปฏิเสธ (ใส่เหตุผล)', dialog: 'exchange-reject', destructive: true },
      { kind: 'dialog', label: "เปลี่ยนเป็น 'ซ่อม' แทน", dialog: 'switch-to-repair' },
    ]);
    expect(secondaryActions(d, 'SALES')).toEqual([
      { kind: 'dialog', label: "เปลี่ยนเป็น 'ซ่อม' แทน", dialog: 'switch-to-repair' },
    ]);
    expect(secondaryActions(d, 'FINANCE_MANAGER')).toEqual([]);
  });

  it('SAME_MODEL_EXCHANGE READY_FOR_PICKUP → รอง: ลิงก์ "สัญญาใหม่ <no>"', () => {
    const d = detail({
      outcome: 'SAME_MODEL_EXCHANGE',
      stage: 'READY_FOR_PICKUP',
      replacementContractId: 'ct-2',
      exchange: {
        kind: 'SAME_MODEL',
        mode: null,
        approvalTier: null,
        requestStatus: null,
        buybackPrice: null,
        ncvSnapshot: null,
        approverRole: 'BRANCH_MANAGER',
        oldProduct: null,
        newProduct: null,
        replacementContract: { id: 'ct-2', contractNumber: 'CT-2026-0099', status: 'DRAFT' },
        requestedBy: null,
      },
    });
    expect(secondaryActions(d, 'OWNER')).toEqual([
      { kind: 'link', label: 'สัญญาใหม่ CT-2026-0099', to: '/contracts/ct-2' },
    ]);
  });

  it('PRICED_EXCHANGE AWAITING_APPROVAL → รอง: "ปฏิเสธ" (OWNER เท่านั้น) · "ยกเลิกคำขอ" (MGR)', () => {
    const d = detail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'AWAITING_APPROVAL',
      exchange: {
        kind: 'PRICED',
        mode: 'PRICED',
        approvalTier: 'REVIEW',
        requestStatus: 'PENDING',
        buybackPrice: '8500.00',
        ncvSnapshot: '10000.00',
        approverRole: 'BRANCH_MANAGER',
        oldProduct: null,
        newProduct: null,
        replacementContract: null,
        requestedBy: null,
      },
    });
    expect(secondaryActions(d, 'OWNER')).toEqual([
      { kind: 'dialog', label: 'ปฏิเสธ', dialog: 'reject-priced', destructive: true },
      { kind: 'dialog', label: 'ยกเลิกคำขอ', dialog: 'cancel-swap' },
    ]);
    expect(secondaryActions(d, 'BRANCH_MANAGER')).toEqual([
      { kind: 'dialog', label: 'ยกเลิกคำขอ', dialog: 'cancel-swap' },
    ]);
    expect(secondaryActions(d, 'SALES')).toEqual([]);
  });

  it('PRICED_EXCHANGE READY_FOR_PICKUP → รอง: "ยกเลิกคำขอ" (MGR) เท่านั้น', () => {
    const d = detail({
      outcome: 'PRICED_EXCHANGE',
      stage: 'READY_FOR_PICKUP',
      replacementContractId: 'ct-3',
    });
    expect(secondaryActions(d, 'OWNER')).toEqual([
      { kind: 'dialog', label: 'ยกเลิกคำขอ', dialog: 'cancel-swap' },
    ]);
    expect(secondaryActions(d, 'SALES')).toEqual([]);
  });

  it('ทุกทาง — CLOSED/CANCELLED ไม่มีปุ่มรอง', () => {
    for (const stage of ['CLOSED', 'CANCELLED'] as const) {
      const d = detail({ outcome: 'REPAIR', stage });
      expect(secondaryActions(d, 'OWNER')).toEqual([]);
    }
  });
});
