import { PrismaService } from '../../../src/prisma/prisma.service';
import { TEST_CUSTOMER_ADDRESS, TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';
import { DocumentsWorld } from './fixtures';

/**
 * DOC-02 (issue #1561) — purchase orders, goods receiving (ใบรับของ) and the
 * trade-in payment voucher (ใบสำคัญจ่ายเงิน / ใบรับเครื่องเทิร์น).
 *
 * Everything here is either a synthetic master row (supplier, valuation table,
 * branch flags the flow needs) or an independent expectation for what the real
 * services must produce (document number shapes, product rows, journal lines).
 * Nothing re-implements the receiving or trade-in services.
 */

/** Operational running numbers — count-based per month, never asserted as a global sequence. */
export const PO_NUMBER = /^PO-\d{4}-\d{2}-\d{3}$/;
export const GR_NUMBER = /^GR-\d{4}-\d{2}-\d{3}$/;
/** EXP-YYYYMMNNNNN (VoucherNumberService). */
export const VOUCHER_NUMBER = /^EXP-\d{11}$/;

export const SHOP_USED_INVENTORY = 'S11-2002';
export const SHOP_BRANCH_CASH = 'S11-1102';
export const SHOP_PAYING_BANK = 'S11-1202';
export const TRADE_IN_CREDIT_LIABILITY = 'S21-2003';

export interface SupplierRow { id: string; name: string; hasVat: boolean }

/** A marked juristic supplier of the world (phone is required by the model). */
export async function createSupplier(prisma: PrismaService, world: DocumentsWorld, options: { label?: string; hasVat?: boolean } = {}): Promise<SupplierRow> {
  const row = await prisma.supplier.create({ data: {
    type: 'JURISTIC', name: `${TEST_NAME_PREFIX} ผู้จำหน่าย ${options.label ?? 'A'} ${world.prefix}`, phone: '020000000',
    contactName: `${TEST_NAME_PREFIX} ผู้ติดต่อ`, address: TEST_CUSTOMER_ADDRESS, taxId: '0000000000000', branchCode: '00000',
    hasVat: options.hasVat ?? true, notes: TEST_CUSTOMER_ADDRESS,
  } });
  return { id: row.id, name: row.name, hasVat: row.hasVat };
}

/** Goods receiving books every PASS unit into the branch flagged `isMainWarehouse` (first active branch otherwise). */
export async function markMainWarehouse(prisma: PrismaService, branchId: string): Promise<void> {
  await prisma.branch.update({ where: { id: branchId }, data: { isMainWarehouse: true } });
}

/**
 * A trade-in needs a SHOP branch (company link for the voucher header and the
 * credit liability) with a per-branch SHOP cash account for CASH payouts
 * (ShopAccountResolver fails closed without it).
 */
export async function attachBranchToShop(prisma: PrismaService, branchId: string, options: { cashAccountCode?: string | null } = {}): Promise<{ shopCompanyId: string }> {
  const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } });
  await prisma.branch.update({ where: { id: branchId }, data: { companyId: shop.id, shopCashAccountCode: options.cashAccountCode === undefined ? SHOP_BRANCH_CASH : options.cashAccountCode } });
  return { shopCompanyId: shop.id };
}

export interface ValuationSeed { brand: string; model: string; storage: string; condition: 'A' | 'B' | 'C' | 'D'; basePrice: number }

/** One synthetic row of the buy-back valuation table (the ±15% appraisal band reads it). */
export async function seedTradeInValuation(prisma: PrismaService, seed: ValuationSeed): Promise<void> {
  await prisma.tradeInValuation.upsert({
    where: { brand_model_storage_condition: { brand: seed.brand, model: seed.model, storage: seed.storage, condition: seed.condition } },
    update: { basePrice: seed.basePrice, deletedAt: null },
    create: { ...seed, note: `${TEST_NAME_PREFIX} ราคากลางจำลอง` },
  });
}

/** Appraisal band the lifecycle enforces against the valuation table. */
export function valuationBand(basePrice: number): { floor: number; ceiling: number } {
  return { floor: basePrice * 0.85, ceiling: basePrice * 1.15 };
}

/** 13-digit Thai national id with a valid mod-11 check digit, never a real person (prefix 7 = synthetic range used by the world). */
export function checksummedNationalId(seed: string): string {
  const digits = `7${seed.replace(/\D/g, '').padEnd(11, '0').slice(0, 11)}`;
  const sum = [...digits].reduce((total, digit, i) => total + Number(digit) * (13 - i), 0);
  return `${digits}${(11 - (sum % 11)) % 10}`;
}

/** 15-digit IMEIs unique per run (partial unique index on active products). No Luhn check exists on the receiving path. */
export function imeiFactory(): (n: number) => string {
  const stamp = Date.now().toString().slice(-9);
  return (n: number) => `99${stamp}${String(n).padStart(4, '0')}`;
}

export interface PoItemSpec { brand: string; model: string; color?: string; storage?: string; category: 'PHONE_NEW' | 'PHONE_USED' | 'ACCESSORY'; accessoryType?: string; accessoryBrand?: string; quantity: number; unitPrice: number }

export function poItemBody(spec: PoItemSpec): Record<string, unknown> {
  return { brand: spec.brand, model: spec.model, color: spec.color, storage: spec.storage, category: spec.category, accessoryType: spec.accessoryType, accessoryBrand: spec.accessoryBrand, quantity: spec.quantity, unitPrice: spec.unitPrice };
}

export interface ReceivingUnit { poItemId: string; imeiSerial?: string; serialNumber?: string; status: 'PASS' | 'REJECT'; rejectReason?: string; defectReason?: string }

/** What one receiving must leave behind: PASS units become products, REJECT units never do. */
export function receivingExpectation(units: ReceivingUnit[]): { passed: number; rejected: number; total: number; passedByPoItem: Record<string, number> } {
  const passedByPoItem: Record<string, number> = {};
  for (const unit of units) if (unit.status === 'PASS') passedByPoItem[unit.poItemId] = (passedByPoItem[unit.poItemId] ?? 0) + 1;
  const passed = units.filter((unit) => unit.status === 'PASS').length;
  return { passed, rejected: units.length - passed, total: units.length, passedByPoItem };
}

export interface SellerEvidence { sellerName: string; sellerPhone: string; sellerIdCardNumber: string; sellerAddress: string }

export function sellerEvidence(world: DocumentsWorld, label = 'A'): SellerEvidence {
  return {
    sellerName: `${TEST_NAME_PREFIX} ผู้ขายเครื่อง ${label} ${world.prefix}`,
    sellerPhone: '0800000002',
    sellerIdCardNumber: checksummedNationalId(`${label.charCodeAt(0)}${world.prefix.replace(/\D/g, '')}`),
    sellerAddress: TEST_CUSTOMER_ADDRESS,
  };
}

export interface ExpectedLine { accountCode: string; debit: string; credit: string }

/** BUYBACK accepted: Dr used-phone inventory / Cr the branch cash (CASH) or the SHOP paying bank (TRANSFER). */
export function expectedBuybackJournal(price: number, paymentMethod: 'CASH' | 'TRANSFER', branchCashCode = SHOP_BRANCH_CASH): ExpectedLine[] {
  const amount = price.toFixed(2);
  return [
    { accountCode: SHOP_USED_INVENTORY, debit: amount, credit: '0.00' },
    { accountCode: paymentMethod === 'CASH' ? branchCashCode : SHOP_PAYING_BANK, debit: '0.00', credit: amount },
  ];
}

/** EXCHANGE accepted: the phone enters used stock at its base value against the trade-in credit liability. */
export function expectedCreditJournal(baseAmount: number): ExpectedLine[] {
  const amount = baseAmount.toFixed(2);
  return [
    { accountCode: SHOP_USED_INVENTORY, debit: amount, credit: '0.00' },
    { accountCode: TRADE_IN_CREDIT_LIABILITY, debit: '0.00', credit: amount },
  ];
}

/** RFC 5987 `filename*=UTF-8''…` part of a Content-Disposition header. */
export function dispositionFilename(header: string | undefined): string | null {
  const match = /filename\*=UTF-8''([^;]+)/.exec(header ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}
