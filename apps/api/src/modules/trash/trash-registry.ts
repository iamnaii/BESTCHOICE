import type { Prisma } from '@prisma/client';
import { maskPhone } from '../../utils/pii.util';

/**
 * ถังขยะรวม (ก้อน 8 · A10) — allow-list เดียวของระบบว่า "อะไรกู้ได้ และกู้แล้วต้องคืนอะไร" (สเปก §4)
 *
 * กติกาเดียวทุกประเภท: การลบเขียน `{ deletedAt, flag=false }` ⇒ การกู้เขียนกลับ `{ deletedAt: null, flag=true }`
 * ห้ามเพิ่มประเภทที่ `deletedAt` แปลว่า "ยกเลิก/แทนที่/รวม" (ใบขาย ค่างวด JE การรวมผู้ติดต่อ …) — ดู §4.3
 * เพิ่มประเภทใหม่ = เพิ่ม entry เดียวในไฟล์นี้ (เทส R2 บังคับว่าโมเดลมี `deletedAt` และ `select` ตรงสคีมา)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TrashAnyRow = Record<string, any>;

export type TrashType =
  | 'customer' | 'booking' | 'todo' | 'repair_ticket' | 'legal_case'
  | 'expense_document' | 'other_income' | 'fixed_asset'
  | 'expense_template' | 'other_income_template' | 'canned_response' | 'notification_template' | 'sms_template'
  | 'promotion' | 'interest_config' | 'reorder_point' | 'dunning_rule' | 'webhook' | 'trade_in_valuation'
  | 'buyback_question' | 'reverse_reason' | 'chart_of_account' | 'payment_method_config'
  | 'gfin_model_mapping' | 'gfin_overprice_rule' | 'gfin_rate_factor' | 'chat_knowledge'
  | 'external_finance_company' | 'supplier' | 'branch'
  | 'product' | 'contract';

export const TRASH_GROUPS = ['ลูกค้าและการขาย', 'เอกสารการเงิน (ร่าง)', 'แม่แบบ', 'ตั้งค่า', 'องค์กร', 'สินค้า'] as const;
export type TrashGroup = (typeof TRASH_GROUPS)[number];

export interface TrashRowView {
  title: string;
  subtitle: string;
  link?: string;
}

export interface TrashRestoreContext {
  tx: Prisma.TransactionClient;
  actorId: string;
}

export interface TrashAfterRestoreServices {
  prisma: { chatRoom: { count(args: { where: { customerId: string } }): Promise<number> } };
  journeyState?: { recompute(ids: string[]): Promise<void> };
  tags?: { recomputeForCustomer(id: string): Promise<unknown> };
}

export interface TrashNotRestorable<Row = TrashAnyRow> {
  reason: string;
  actionLabel?: string;
  linkFor?: (row: Row) => string | undefined;
}

export interface TrashEntry<Row = TrashAnyRow> {
  type: TrashType;
  label: string;
  group: TrashGroup;
  /** ชื่อ delegate ของ Prisma เช่น 'customer' (model `Customer`) */
  model: string;
  /** ฟิลด์ที่ list/restore ต้องใช้ — ต้องมี `id` และ `deletedAt` เสมอ */
  select: Record<string, unknown>;
  /** ฟิลด์ string ที่ค้นด้วย contains (insensitive) */
  searchFields: string[];
  /** เงื่อนไขเพิ่มของ "ของที่เข้าถัง" เช่น ลูกค้าที่ไม่ใช่ placeholder ที่ถูกรวม */
  extraWhere?: Record<string, unknown>;
  /** ค่า `entity` ของแถว AuditLog ที่บันทึกการลบ (interceptor ใช้ segment แรกของ URL) — ใช้คู่กับ index (entity, entityId) */
  auditEntities: string[];
  /** entityId ของแถว audit เมื่อ route ไม่ได้ใช้ id แถว (เช่น คดี = contractId) */
  auditEntityId?(row: Row): string;
  toRow(row: Row): TrashRowView;
  restorable: true | TrashNotRestorable<Row>;
  /** ตรวจก่อนเขียน (ใน tx) — โยน Nest exception ภาษาไทยเมื่อกู้ไม่ได้ */
  check?(ctx: TrashRestoreContext, row: Row): Promise<void>;
  /** งานในทรานแซกชันเดียวกันหลัง update แถวหลัก (เช่น กู้แถวลูกที่ถูกลบพร้อมกัน) */
  restoreExtra?(ctx: TrashRestoreContext, row: Row): Promise<void>;
  /** คำเตือนที่แสดงหลังกู้ (ไม่ใช่ error) */
  warnings?(row: Row): string[];
  /** งานนอก tx หลัง commit (recompute แคช) — คืน warnings เพิ่ม */
  afterRestore?(row: Row, services: TrashAfterRestoreServices): Promise<string[]>;
}

export const RESTORE_AUDIT_ACTION = 'RESTORED';
/** action ของแถว AuditLog ที่บันทึกการลบ — interceptor ใช้ 'DELETE' ส่วน service บางตัวเขียน action ของตัวเอง */
export const DELETE_AUDIT_ACTIONS = ['DELETE', 'DELETED', 'BOOKING_DELETED', 'OI_DELETED', 'REPAIR_TICKET_SOFT_DELETED', 'CONTRACT_DELETE'];

const money = (value: unknown): string => {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const safePhone = (value: unknown): string => (typeof value === 'string' && value ? maskPhone(value) : '-');
const joinParts = (...parts: Array<string | null | undefined>): string => parts.filter((p) => p && String(p).trim().length > 0).join(' · ');

const BASE_SELECT = { id: true, deletedAt: true } as const;
/** §13.1 — ประเภทที่การลบตั้ง flag ปิดใช้งาน: กู้แล้วยังปิดอยู่ ให้เปิดเองที่หน้านั้น (ทุกหน้ามีสวิตช์) */
const stillDisabled = (page: string) => () => [`กู้แล้วยังปิดใช้งานอยู่ — เปิดได้ที่หน้า ${page}`];

export const TRASH_REGISTRY: readonly TrashEntry[] = [
  // ─── ลูกค้าและการขาย ───────────────────────────────────────────────────────────────────
  {
    type: 'customer', label: 'ลูกค้า / ผู้สนใจ', group: 'ลูกค้าและการขาย', model: 'customer',
    select: { ...BASE_SELECT, name: true, phone: true, phoneHash: true, email: true, mergedIntoId: true },
    searchFields: ['name', 'phone'],
    extraWhere: { mergedIntoId: null },
    auditEntities: ['customers'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(`โทร ${safePhone(r.phone)}`, r.email ? 'มีอีเมล' : null), link: `/customers/${r.id}` }),
    restorable: true,
  },
  {
    type: 'booking', label: 'ใบจอง', group: 'ลูกค้าและการขาย', model: 'booking',
    select: { ...BASE_SELECT, bookingNumber: true, status: true, totalAmount: true, lockedProductId: true, branchId: true, customer: { select: { name: true } }, branch: { select: { name: true } } },
    searchFields: ['bookingNumber'],
    auditEntities: ['bookings'],
    toRow: (r) => ({ title: `${r.bookingNumber} · ${r.customer?.name ?? '-'}`, subtitle: joinParts(`ยอด ${money(r.totalAmount)}`, r.branch?.name, r.status === 'PENDING_DEPOSIT' ? 'รอมัดจำ' : r.status) }),
    restorable: true,
  },
  {
    type: 'todo', label: 'งาน', group: 'ลูกค้าและการขาย', model: 'todo',
    select: { ...BASE_SELECT, title: true, status: true, dueDate: true },
    searchFields: ['title'],
    auditEntities: ['todos'],
    toRow: (r) => ({ title: r.title, subtitle: joinParts(r.status) }),
    restorable: true,
  },
  {
    type: 'repair_ticket', label: 'ใบซ่อม', group: 'ลูกค้าและการขาย', model: 'repairTicket',
    select: { ...BASE_SELECT, ticketNumber: true, status: true, deviceBrand: true, deviceModel: true, customer: { select: { name: true } } },
    searchFields: ['ticketNumber', 'deviceModel'],
    auditEntities: ['repair-tickets'],
    toRow: (r) => ({ title: `${r.ticketNumber} · ${r.customer?.name ?? '-'}`, subtitle: joinParts(r.deviceBrand, r.deviceModel, r.status) }),
    restorable: true,
  },
  {
    type: 'legal_case', label: 'คดี', group: 'ลูกค้าและการขาย', model: 'legalCase',
    select: { ...BASE_SELECT, caseNumber: true, court: true, contractId: true, contract: { select: { contractNumber: true } } },
    searchFields: ['caseNumber', 'court'],
    auditEntities: ['legal-cases'],
    auditEntityId: (r) => r.contractId,
    toRow: (r) => ({ title: `${r.caseNumber} · สัญญา ${r.contract?.contractNumber ?? '-'}`, subtitle: joinParts(r.court) }),
    restorable: true,
  },
  {
    type: 'contract', label: 'ร่างสัญญา', group: 'ลูกค้าและการขาย', model: 'contract',
    select: { ...BASE_SELECT, contractNumber: true, status: true, workflowStatus: true, downPayment: true, customer: { select: { name: true } } },
    searchFields: ['contractNumber'],
    auditEntities: ['contracts', 'contract'],
    extraWhere: { status: 'DRAFT' },
    toRow: (r) => ({ title: `${r.contractNumber} · ${r.customer?.name ?? '-'}`, subtitle: joinParts(`ดาวน์ ${money(r.downPayment)}`, r.workflowStatus) }),
    restorable: { reason: 'ตอนลบระบบคืนเงินดาวน์/เครดิตเทิร์นและปลดเครื่องไปแล้ว — ต้องทำสัญญาใหม่' },
  },

  // ─── เอกสารการเงิน (ร่าง) ───────────────────────────────────────────────────────────────
  {
    type: 'expense_document', label: 'ใบรายจ่าย (ร่าง)', group: 'เอกสารการเงิน (ร่าง)', model: 'expenseDocument',
    select: { ...BASE_SELECT, number: true, status: true, vendorName: true, totalAmount: true, branchId: true, branch: { select: { name: true } } },
    searchFields: ['number', 'vendorName'],
    auditEntities: ['expense-documents', 'expense_document'],
    toRow: (r) => ({ title: `${r.number} · ${r.vendorName ?? '-'}`, subtitle: joinParts(`ยอด ${money(r.totalAmount)}`, r.branch?.name, r.status === 'DRAFT' ? 'ร่าง (ยังไม่ลงบัญชี)' : r.status), link: `/expenses/${r.id}` }),
    restorable: true,
  },
  {
    type: 'other_income', label: 'รายได้อื่น (ร่าง)', group: 'เอกสารการเงิน (ร่าง)', model: 'otherIncome',
    select: { ...BASE_SELECT, docNumber: true, status: true, counterpartyName: true, totalAmount: true },
    searchFields: ['docNumber', 'counterpartyName'],
    auditEntities: ['other-income', 'other_income'],
    toRow: (r) => ({ title: `${r.docNumber} · ${r.counterpartyName ?? '-'}`, subtitle: joinParts(`ยอด ${money(r.totalAmount)}`, r.status === 'DRAFT' ? 'ร่าง' : r.status) }),
    restorable: true,
  },
  {
    type: 'fixed_asset', label: 'สินทรัพย์ (ร่าง)', group: 'เอกสารการเงิน (ร่าง)', model: 'fixedAsset',
    select: { ...BASE_SELECT, assetCode: true, docNo: true, name: true, status: true, purchaseCost: true },
    searchFields: ['assetCode', 'docNo', 'name'],
    auditEntities: ['assets'],
    toRow: (r) => ({ title: `${r.assetCode} · ${r.name}`, subtitle: joinParts(r.docNo, `ต้นทุน ${money(r.purchaseCost)}`, r.status) }),
    restorable: true,
  },

  // ─── แม่แบบ ──────────────────────────────────────────────────────────────────────────────
  {
    type: 'expense_template', label: 'รายจ่ายโปรด / บิลประจำ', group: 'แม่แบบ', model: 'expenseTemplate',
    select: { ...BASE_SELECT, name: true, isRecurring: true, createdById: true, branch: { select: { name: true } } },
    searchFields: ['name'],
    auditEntities: ['expense-templates'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.branch?.name, r.isRecurring ? 'บิลประจำ' : 'แม่แบบรายจ่าย') }),
    restorable: true,
    warnings: (r) => (r.isRecurring ? ['บิลประจำจะเริ่มสร้างงวดใหม่ในรอบถัดไป (งวดเดิมที่ค้างไม่ถูกแตะ)'] : []),
  },
  {
    type: 'other_income_template', label: 'แม่แบบรายได้อื่น', group: 'แม่แบบ', model: 'otherIncomeTemplate',
    select: { ...BASE_SELECT, name: true, priceType: true },
    searchFields: ['name'],
    auditEntities: ['other-income'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.priceType) }),
    restorable: true,
  },
  {
    type: 'canned_response', label: 'แม่แบบแชท', group: 'แม่แบบ', model: 'cannedResponse',
    select: { ...BASE_SELECT, shortcut: true, title: true, category: true },
    searchFields: ['title', 'shortcut'],
    auditEntities: ['staff-chat'],
    toRow: (r) => ({ title: `${r.title} (${r.shortcut})`, subtitle: joinParts(r.category) }),
    restorable: true,
  },
  {
    type: 'notification_template', label: 'แม่แบบแจ้งเตือน', group: 'แม่แบบ', model: 'notificationTemplate',
    select: { ...BASE_SELECT, eventType: true, name: true, channelKey: true },
    searchFields: ['eventType', 'name'],
    auditEntities: ['notifications'],
    toRow: (r) => ({ title: `${r.eventType} · ${r.name}`, subtitle: joinParts(r.channelKey, 'ถูกปิดใช้งานตอนลบ') }),
    restorable: true,
    warnings: stillDisabled('แจ้งเตือน › แม่แบบข้อความ'),
  },
  {
    type: 'sms_template', label: 'แม่แบบ SMS', group: 'แม่แบบ', model: 'smsTemplate',
    select: { ...BASE_SELECT, name: true, channel: true },
    searchFields: ['name'],
    auditEntities: ['sms-templates'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.channel) }),
    restorable: true,
    warnings: stillDisabled('ตั้งค่า › แม่แบบ SMS'),
  },

  // ─── ตั้งค่า ─────────────────────────────────────────────────────────────────────────────
  {
    type: 'promotion', label: 'โปรโมชัน', group: 'ตั้งค่า', model: 'promotion',
    select: { ...BASE_SELECT, name: true, type: true },
    searchFields: ['name'],
    auditEntities: ['promotions'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.type) }),
    restorable: true,
  },
  {
    type: 'interest_config', label: 'ดอกเบี้ย / เงื่อนไขผ่อน', group: 'ตั้งค่า', model: 'interestConfig',
    select: { ...BASE_SELECT, name: true, interestRate: true },
    searchFields: ['name'],
    auditEntities: ['interest-configs'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(`ดอกเบี้ย ${r.interestRate}%`) }),
    restorable: true,
    warnings: stillDisabled('ตั้งค่า › การเงิน › ดอกเบี้ย'),
  },
  {
    type: 'reorder_point', label: 'จุดสั่งซื้อซ้ำ', group: 'ตั้งค่า', model: 'reorderPoint',
    select: { ...BASE_SELECT, brand: true, model: true, storage: true, minQuantity: true, branch: { select: { name: true } } },
    searchFields: ['brand', 'model'],
    auditEntities: ['reorder-points'],
    toRow: (r) => ({ title: joinParts(r.brand, r.model, r.storage), subtitle: joinParts(r.branch?.name, `ขั้นต่ำ ${r.minQuantity}`) }),
    restorable: true,
  },
  {
    type: 'dunning_rule', label: 'กฎทวงหนี้', group: 'ตั้งค่า', model: 'dunningRule',
    select: { ...BASE_SELECT, name: true, triggerDay: true },
    searchFields: ['name'],
    auditEntities: ['overdue'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(`วันที่ ${r.triggerDay}`) }),
    restorable: true,
  },
  {
    type: 'webhook', label: 'Webhook', group: 'ตั้งค่า', model: 'webhookSubscription',
    select: { ...BASE_SELECT, name: true, url: true },
    searchFields: ['name', 'url'],
    auditEntities: ['webhooks'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.url) }),
    restorable: true,
  },
  {
    type: 'trade_in_valuation', label: 'ราคารับซื้อมือสอง', group: 'ตั้งค่า', model: 'tradeInValuation',
    select: { ...BASE_SELECT, brand: true, model: true, storage: true, condition: true, basePrice: true },
    searchFields: ['brand', 'model'],
    auditEntities: ['trade-ins'],
    toRow: (r) => ({ title: joinParts(r.brand, r.model, r.storage), subtitle: joinParts(`เกรด ${r.condition}`, `ราคา ${money(r.basePrice)}`) }),
    restorable: true,
    warnings: () => ['ราคานี้กลับมาแสดงบนหน้ารับซื้อทันที'],
  },
  {
    type: 'buyback_question', label: 'คำถามรับซื้อ', group: 'ตั้งค่า', model: 'buybackQuestion',
    select: { ...BASE_SELECT, key: true, title: true },
    searchFields: ['key', 'title'],
    auditEntities: ['trade-ins'],
    toRow: (r) => ({ title: r.title, subtitle: joinParts(r.key) }),
    restorable: true,
  },
  {
    type: 'reverse_reason', label: 'เหตุผลกลับรายการ', group: 'ตั้งค่า', model: 'reverseReason',
    select: { ...BASE_SELECT, label: true },
    searchFields: ['label'],
    auditEntities: ['settings'],
    toRow: (r) => ({ title: r.label, subtitle: '' }),
    restorable: true,
    warnings: stillDisabled('ตั้งค่า › ผู้ใช้ & สิทธิ์ › เหตุผลกลับรายการ'),
  },
  {
    type: 'chart_of_account', label: 'ผังบัญชี', group: 'ตั้งค่า', model: 'chartOfAccount',
    select: { ...BASE_SELECT, code: true, name: true, type: true },
    searchFields: ['code', 'name'],
    auditEntities: ['chart-of-accounts'],
    toRow: (r) => ({ title: `${r.code} ${r.name}`, subtitle: joinParts(r.type) }),
    restorable: true,
  },
  {
    type: 'payment_method_config', label: 'ช่องทางรับเงิน', group: 'ตั้งค่า', model: 'paymentMethodConfig',
    select: { ...BASE_SELECT, method: true, accountCode: true },
    searchFields: ['method', 'accountCode'],
    auditEntities: ['payment-method-configs'],
    toRow: (r) => ({ title: `${r.method} → ${r.accountCode}`, subtitle: '' }),
    restorable: true,
    warnings: stillDisabled('ตั้งค่า › การเงิน › ช่องทางชำระเงิน'),
  },
  {
    type: 'gfin_model_mapping', label: 'GFIN — ราคาสูงสุดต่อรุ่น', group: 'ตั้งค่า', model: 'gfinModelMapping',
    select: { ...BASE_SELECT, gfinSeries: true, gfinVariant: true, storage: true, condition: true, maxPrice: true },
    searchFields: ['gfinSeries', 'gfinVariant'],
    auditEntities: ['gfin-config'],
    toRow: (r) => ({ title: joinParts(r.gfinSeries, r.gfinVariant, r.storage), subtitle: joinParts(r.condition, `สูงสุด ${money(r.maxPrice)}`) }),
    restorable: true,
  },
  {
    type: 'gfin_overprice_rule', label: 'GFIN — กฎราคาเกิน', group: 'ตั้งค่า', model: 'gfinOverpriceRule',
    select: { ...BASE_SELECT, label: true, condition: true, allowance: true },
    searchFields: ['label'],
    auditEntities: ['gfin-config'],
    toRow: (r) => ({ title: r.label, subtitle: joinParts(r.condition, `เผื่อ ${money(r.allowance)}`) }),
    restorable: true,
  },
  {
    type: 'gfin_rate_factor', label: 'GFIN — เรทต่องวด', group: 'ตั้งค่า', model: 'gfinRateFactor',
    select: { ...BASE_SELECT, months: true, shopCommissionPct: true, factor: true },
    searchFields: [],
    auditEntities: ['gfin-config'],
    toRow: (r) => ({ title: `${r.months} งวด · คอม ${r.shopCommissionPct}%`, subtitle: joinParts(`factor ${r.factor}`) }),
    restorable: true,
  },
  {
    type: 'chat_knowledge', label: 'FAQ บอท', group: 'ตั้งค่า', model: 'chatKnowledgeBase',
    select: { ...BASE_SELECT, category: true, intent: true },
    searchFields: ['category', 'intent'],
    auditEntities: ['chatbot'],
    toRow: (r) => ({ title: r.intent, subtitle: joinParts(r.category) }),
    restorable: true,
    warnings: stillDisabled('ฐานความรู้บอทไฟแนนซ์'),
  },

  // ─── องค์กร ─────────────────────────────────────────────────────────────────────────────
  {
    type: 'external_finance_company', label: 'ไฟแนนซ์นอก', group: 'องค์กร', model: 'externalFinanceCompany',
    select: { ...BASE_SELECT, name: true, contactPerson: true },
    searchFields: ['name'],
    auditEntities: ['external-finance'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.contactPerson) }),
    restorable: true,
    warnings: stillDisabled('ไฟแนนซ์ภายนอก'),
  },
  {
    type: 'supplier', label: 'ผู้จัดจำหน่าย', group: 'องค์กร', model: 'supplier',
    select: { ...BASE_SELECT, name: true, phone: true, type: true },
    searchFields: ['name', 'phone'],
    auditEntities: ['suppliers'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.type, `โทร ${safePhone(r.phone)}`), link: `/suppliers/${r.id}` }),
    restorable: true,
    warnings: stillDisabled('ผู้จัดจำหน่าย'),
  },
  {
    type: 'branch', label: 'สาขา', group: 'องค์กร', model: 'branch',
    select: { ...BASE_SELECT, name: true, location: true },
    searchFields: ['name'],
    auditEntities: ['branches'],
    toRow: (r) => ({ title: r.name, subtitle: joinParts(r.location) }),
    restorable: true,
    warnings: () => ['กู้แล้วยังปิดใช้งานอยู่ — เปิดได้ที่หน้า สาขา', 'ผู้ใช้/สต๊อกของสาขาไม่เคยถูกย้าย'],
  },

  // ─── สินค้า — เห็นในถังแต่กู้ผ่านคำขอ "พบของคืน" เท่านั้น (database.md: ด่านเดียวของระบบ) ─────
  {
    type: 'product', label: 'สินค้า', group: 'สินค้า', model: 'product',
    select: { ...BASE_SELECT, name: true, brand: true, model: true, storage: true, imeiSerial: true, status: true, costPrice: true, branch: { select: { name: true } } },
    searchFields: ['imeiSerial', 'name', 'model'],
    auditEntities: ['products'],
    toRow: (r) => ({ title: joinParts(r.brand, r.model, r.storage) || r.name, subtitle: joinParts(r.imeiSerial ? `IMEI …${String(r.imeiSerial).slice(-4)}` : null, `ก่อนลบ: ${r.status}`, r.branch?.name) }),
    restorable: {
      reason: 'กู้เครื่องผ่านคำขอ "พบของคืน" (เจ้าของอนุมัติ · กลับรายการบัญชีให้ · IMEI ซ้ำจะถูกแจ้ง)',
      actionLabel: 'ขอพบของคืน',
      linkFor: (r) => `/stock/adjustments?request=found&q=${encodeURIComponent(r.imeiSerial ?? '')}`,
    },
  },
];

const BY_TYPE = new Map<string, TrashEntry>(TRASH_REGISTRY.map((e) => [e.type, e]));

export function trashEntry(type: string): TrashEntry | undefined {
  return BY_TYPE.get(type);
}

export function isTrashType(type: string): type is TrashType {
  return BY_TYPE.has(type);
}
