import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { Prisma } from '@prisma/client';
import { TradeInCreditSnapshot, hasCompanyAccess } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';

const ACCOUNT = 'S21-2003';
const D = Prisma.Decimal;
type Target = { saleId: string; contractId?: never } | { contractId: string; saleId?: never };
type QuoteInput = { tradeInId: string; customerId: string; branchId: string; productId: string; priceAfterDiscount: number };

export function creditSnapshot(value: Prisma.JsonValue | undefined): TradeInCreditSnapshot | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || value.version !== 1
    || typeof value.redemptionId !== 'string' || typeof value.tradeInId !== 'string'
    || !['baseAmount', 'bonusAmount', 'cashDownAmount', 'totalDownAmount'].every((k) => typeof value[k] === 'string' && /^\d+(\.\d{1,2})?$/.test(value[k] as string))) {
    throw new BadRequestException('ข้อมูลเครดิตเทิร์นในเอกสารไม่สมบูรณ์ กรุณาตรวจสอบ');
  }
  const snapshot = value as TradeInCreditSnapshot;
  if (!new D(snapshot.baseAmount).gt(0) || !new D(snapshot.cashDownAmount).plus(snapshot.baseAmount).eq(snapshot.totalDownAmount)) {
    throw new BadRequestException('ยอดเครดิตเทิร์นในเอกสารไม่ตรงกัน');
  }
  return snapshot;
}

export function cashDownPayment(contract: { downPayment: Prisma.Decimal | number; tradeInCreditSnapshot?: Prisma.JsonValue }): Prisma.Decimal {
  const snapshot = creditSnapshot(contract.tradeInCreditSnapshot);
  if (!snapshot) return new D(contract.downPayment);
  if (!new D(contract.downPayment).eq(snapshot.totalDownAmount)) throw new BadRequestException('เงินดาวน์ไม่ตรงกับหลักฐานเครดิตเทิร์น');
  return new D(snapshot.cashDownAmount);
}

/** All writes take the caller's transaction: claims, money and stock commit together. */
export class TradeInCreditService {
  private readonly journal: JournalAutoService;
  private readonly companies: CompanyResolverService;
  constructor(private readonly prisma: PrismaService) {
    this.journal = new JournalAutoService(prisma);
    this.companies = new CompanyResolverService(prisma);
  }

  private async shop(tx: Prisma.TransactionClient, branchId: string) {
    const companyId = await this.companies.getShopCompanyId(tx);
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.deletedAt || branch.companyId !== companyId) throw new BadRequestException('เครดิตเทิร์นใช้ได้เฉพาะสาขา SHOP');
    const account = await tx.chartOfAccount.findUnique({ where: { code: ACCOUNT } });
    if (!account || account.deletedAt || account.status !== 'ใช้งาน' || account.type !== 'หนี้สิน' || account.normalBalance !== 'Cr') {
      throw new BadRequestException('กรุณาตั้งค่าบัญชีเครดิตเทิร์น SHOP ให้พร้อมก่อนทำรายการ');
    }
    return companyId;
  }

  // อ่านแถว user จาก tx ตรง ๆ (ไม่ใช่ req.user) จึงไม่ถูกครอบด้วย JwtStrategy ที่ resolve
  // สิทธิ์บริษัทให้แล้ว — ต้องเรียก hasCompanyAccess เองเพื่อให้กฎ "array ว่าง = ยังไม่ตั้งค่า"
  // ใช้ชุดเดียวกับที่อื่น ไม่ใช่ปฏิเสธแถวที่ยังไม่ backfill
  private async assertActor(tx: Prisma.TransactionClient, actorId: string, branchId: string) {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor || actor.deletedAt || !actor.isActive
      || !hasCompanyAccess(actor.role, actor.accessibleCompanies, 'SHOP')
      || !['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(actor.role)
      || (!hasCrossBranchAccess(actor) && actor.branchId !== branchId)) {
      throw new ForbiddenException('ต้องมีสิทธิ์ SHOP และสาขาที่ทำรายการเครดิตเทิร์น');
    }
  }

  async issue(tx: Prisma.TransactionClient, tradeInId: string, base: Prisma.Decimal, bonus: Prisma.Decimal) {
    const row = await tx.tradeIn.findUniqueOrThrow({ where: { id: tradeInId } });
    if (row.flow !== 'EXCHANGE' || row.status !== 'ACCEPTED' || !row.idCardVerifiedAt || !row.sellerDeclarationSnapshot || !row.branchId) {
      throw new BadRequestException('ต้องตรวจหลักฐานและรับเครื่องก่อนออกเครดิตเทิร์น');
    }
    if (row.creditIssuedAt) throw new ConflictException('ออกเครดิตเทิร์นรายการนี้แล้ว');
    await this.assertActor(tx, row.idCardVerifiedById!, row.branchId);
    if (!base.gt(0) || bonus.lt(0) || base.decimalPlaces() > 2 || bonus.decimalPlaces() > 2
      || !base.plus(bonus).eq(row.agreedPrice ?? 0)) throw new BadRequestException('มูลค่าเครื่องและโบนัสเทิร์นไม่ตรงกับราคาตกลง');
    const companyId = await this.shop(tx, row.branchId);
    const entry = await this.journal.createAndPost({
      description: `รับเครื่องเทิร์นรอใช้เครดิต ${row.id}`, reference: `tradein:${row.id}`, companyId,
      metadata: { flow: 'shop-trade-in-credit-issued', tradeInId: row.id, baseAmount: base.toFixed(2), bonusAmount: bonus.toFixed(2) },
      lines: [
        { accountCode: 'S11-2002', dr: base, cr: new D(0), description: 'รับสินค้ามือสองจากการเทิร์น' },
        { accountCode: ACCOUNT, dr: new D(0), cr: base, description: 'เครดิตมูลค่าเครื่องรอใช้ซื้อสินค้า' },
      ],
    }, tx);
    await tx.tradeIn.update({ where: { id: row.id, creditIssuedAt: null }, data: {
      creditBaseAmount: base, creditBonusAmount: bonus, creditIssuedAt: new Date(), creditIssueJournalId: entry.id,
    } });
    if (row.productId) await tx.product.update({ where: { id: row.productId }, data: { ownedByCompanyId: companyId } });
  }

  async available(customerId: string, branchId: string) {
    if (!customerId || !branchId) throw new BadRequestException('กรุณาเลือกลูกค้าและสาขาก่อน');
    await this.shop(this.prisma, branchId);
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw new BadRequestException('ไม่พบลูกค้า');
    const rows = await this.prisma.tradeIn.findMany({ where: { flow: 'EXCHANGE', deletedAt: null,
      branchId, status: { in: ['ACCEPTED', 'COMPLETED'] }, creditIssuedAt: { not: null }, currentRedemptionId: null,
      OR: [{ customerId }, ...(customer.contactId ? [{ customerId: null, sellerContactId: customer.contactId }] : [])],
    }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => ({ id: row.id, voucherNumber: row.voucherNumber,
      deviceLabel: `${row.deviceBrand} ${row.deviceModel}`, baseAmount: row.creditBaseAmount!.toFixed(2),
      bonusAmount: row.creditBonusAmount!.toFixed(2), totalAmount: row.creditBaseAmount!.plus(row.creditBonusAmount!).toFixed(2) }));
  }

  async quote(tx: Prisma.TransactionClient, input: QuoteInput) {
    const row = await tx.tradeIn.findUnique({ where: { id: input.tradeInId } });
    if (!row || row.deletedAt || row.flow !== 'EXCHANGE' || !['ACCEPTED', 'COMPLETED'].includes(row.status)
      || !row.creditIssuedAt || !row.creditIssueJournalId || !row.creditBaseAmount || !row.creditBonusAmount
      || row.currentRedemptionId) throw new BadRequestException('เครดิตเทิร์นนี้ไม่พร้อมใช้หรือถูกใช้ไปแล้ว');
    const companyId = await this.shop(tx, input.branchId);
    const customer = await tx.customer.findUnique({ where: { id: input.customerId, deletedAt: null } });
    if (!customer || (row.customerId ? row.customerId !== customer.id : (!customer.contactId || row.sellerContactId !== customer.contactId))) {
      throw new BadRequestException('เครดิตเทิร์นไม่ใช่ของลูกค้าที่เลือก');
    }
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (row.branchId !== input.branchId || !product || product.deletedAt || product.branchId !== input.branchId
      || (product.ownedByCompanyId && product.ownedByCompanyId !== companyId) || product.id === row.productId) {
      throw new BadRequestException('เครดิตเทิร์นต้องใช้ซื้อเครื่องใหม่ในสาขา SHOP ที่รับเครื่อง');
    }
    const issued = await tx.journalEntry.findUnique({ where: { id: row.creditIssueJournalId } });
    if (!issued || issued.deletedAt || issued.status !== 'POSTED' || (issued.metadata as Record<string, unknown> | null)?.reversed) {
      throw new BadRequestException('บัญชีเครดิตเทิร์นยังไม่พร้อมใช้');
    }
    const base = row.creditBaseAmount, bonus = row.creditBonusAmount;
    const net = new D(input.priceAfterDiscount).minus(bonus);
    if (!base.gt(0) || bonus.lt(0) || net.lt(base)) throw new BadRequestException('ต้องใช้เครดิตเทิร์นเต็มยอด และยอดเครดิตต้องไม่เกินราคาสินค้า');
    return { row, base, bonus, net, companyId };
  }

  async claim(tx: Prisma.TransactionClient, input: QuoteInput & { target: Target; cashAmount: number; actorId: string },
    cashAccountCode?: string): Promise<TradeInCreditSnapshot> {
    await this.assertActor(tx, input.actorId, input.branchId);
    const quote = await this.quote(tx, input);
    const cash = new D(input.cashAmount), total = cash.plus(quote.base);
    if (!cash.isFinite() || cash.lt(0) || cash.decimalPlaces() > 2) throw new BadRequestException('ยอดเงินสด/โอนไม่ถูกต้อง');
    if (input.target.contractId ? total.gte(quote.net) : !total.eq(quote.net)) {
      throw new BadRequestException('ยอดชำระเงินและเครดิตเทิร์นไม่ตรงกับราคาขาย');
    }
    const redemption = await tx.tradeInCreditRedemption.create({ data: {
      tradeInId: input.tradeInId, ...input.target, baseAmount: quote.base, bonusAmount: quote.bonus, createdById: input.actorId,
    } });
    const claimed = await tx.tradeIn.updateMany({ where: { id: input.tradeInId, currentRedemptionId: null, deletedAt: null },
      data: { currentRedemptionId: redemption.id } });
    if (claimed.count !== 1) throw new ConflictException('เครดิตเทิร์นถูกใช้โดยรายการอื่นแล้ว กรุณาตรวจสอบใหม่');
    const creditAccount = input.target.contractId ? 'S21-2001' : cashAccountCode;
    if (!creditAccount?.startsWith('S')) throw new BadRequestException('ต้องระบุบัญชีรับเงิน SHOP');
    const entry = await this.journal.createAndPost({
      description: `ใช้เครดิตเทิร์น ${input.tradeInId}`, reference: `tradein-credit:${redemption.id}`, companyId: quote.companyId,
      metadata: { flow: 'shop-trade-in-credit-applied', tradeInId: input.tradeInId, redemptionId: redemption.id, ...input.target },
      lines: [
        { accountCode: ACCOUNT, dr: quote.base, cr: new D(0), description: 'ใช้มูลค่าเครื่องเทิร์น' },
        { accountCode: creditAccount, dr: new D(0), cr: quote.base, description: input.target.contractId ? 'ชำระล่วงหน้าด้วยเครื่องเทิร์น' : 'หักส่วนที่ชำระด้วยเครื่องเทิร์นออกจากเงินรับ' },
      ],
    }, tx);
    await tx.tradeInCreditRedemption.update({ where: { id: redemption.id }, data: { applicationJournalEntryId: entry.id } });
    return { version: 1, redemptionId: redemption.id, tradeInId: input.tradeInId, voucherNumber: quote.row.voucherNumber,
      baseAmount: quote.base.toFixed(2), bonusAmount: quote.bonus.toFixed(2), cashDownAmount: cash.toFixed(2), totalDownAmount: total.toFixed(2) };
  }

  async release(tx: Prisma.TransactionClient, value: Prisma.JsonValue | undefined, target: Target, actorId: string, reason: string, reverse = false) {
    const snapshot = creditSnapshot(value);
    if (!snapshot) return;
    const redemption = await tx.tradeInCreditRedemption.findUnique({ where: { id: snapshot.redemptionId } });
    if (!redemption || redemption.tradeInId !== snapshot.tradeInId || redemption.saleId !== (target.saleId ?? null)
      || redemption.contractId !== (target.contractId ?? null) || !redemption.applicationJournalEntryId) throw new BadRequestException('ไม่พบหลักฐานใช้เครดิตเทิร์นของเอกสารนี้');
    if (redemption.releasedAt) return;
    if (reverse) await new ExchangeCancelReversalTemplate(this.journal, this.prisma).reverse({
      jeIds: [redemption.applicationJournalEntryId], flowLabel: 'shop-trade-in-credit-released',
    }, tx);
    const entry = await tx.journalEntry.findUnique({ where: { id: redemption.applicationJournalEntryId } });
    if ((entry?.metadata as Record<string, unknown> | null)?.reversed !== true) throw new BadRequestException('ต้องกลับรายการบัญชีใช้เครดิตก่อนคืนเครดิตเทิร์น');
    const released = await tx.tradeIn.updateMany({ where: { id: redemption.tradeInId, currentRedemptionId: redemption.id }, data: { currentRedemptionId: null } });
    if (released.count !== 1) throw new ConflictException('สถานะเครดิตเทิร์นเปลี่ยนแล้ว');
    await tx.tradeInCreditRedemption.update({ where: { id: redemption.id, releasedAt: null }, data: {
      releasedAt: new Date(), releasedById: actorId, releaseReason: reason,
    } });
  }
}
