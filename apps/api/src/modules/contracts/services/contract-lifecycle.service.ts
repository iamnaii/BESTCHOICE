import { isRetryablePrismaWriteError } from '../../../utils/transaction-retry.util';
import { cleanupCreditContractSale } from '../../trade-in/services/credit-contract-cleanup.util';
import { Injectable, HttpException, Logger, NotFoundException, BadRequestException, ForbiddenException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { StructuredLoggerService } from '../../../common/logger';
import { TradeInCreditService, cashDownPayment } from '../../trade-in/services/trade-in-credit.service';
import { ContractQuoteService, contractQuotePayments } from './contract-quote.service';
import { assertCustomerContractPolicy, assertCustomerHasPhone, customerContractSnapshot, contractDownTender } from './contract-create-policy';
import { ShopTenderRecorder } from '../../shop-tenders/shop-tender.recorder';
import { normalizeTenders } from '../../shop-tenders/shop-tender.util';
import { assertSaleProductEligible } from '../../sales/services/sale-product-policy';
import { PlanType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateContractDto, UpdateContractDto } from '../dto/contract.dto';
import { generateContractNumber } from '../../../utils/sequence.util';
import { d } from '../../../utils/decimal.util';
import { WarrantyService } from '../../warranty/warranty.service';
import { AuditService } from '../../audit/audit.service';
import { ContractQueryService } from './contract-query.service';
import { ShopDownPaymentTemplate } from '../../journal/cpa-templates/shop-down-payment.template';
import { ShopDownPaymentReversalTemplate } from '../../journal/cpa-templates/shop-down-payment-reversal.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { preemptReservationsInTx } from '../../../utils/reservation-preempt.util';
import { assertSameTestSide, TEST_SIDE_CUSTOMER_SELECT } from '../../../utils/test-data-markers';
import { claimCreditApproval, assertContractCreditApproval } from '../../credit-check/services/credit-approval';
import { lockCreditCustomer } from '../../credit-check/services/room-credit-history';
import { MAX_CONTRACT_BUNDLES, normalizeBundleIds, releaseContractBundles, reserveContractBundles } from './contract-bundle.util';

/**
 * ContractLifecycleService — write-side lifecycle of a contract: create
 * (retry-wrapped $tx + money math + warranty fire-and-forget + audit),
 * update (recalc $tx + schedule rebuild), softDelete (6-op array $tx),
 * updateSalesperson ($tx). Reads go through ContractQueryService so the
 * shared `findOne` / `isTestModeEnabled` stay single-source.
 */
@Injectable()
export class ContractLifecycleService {
  private readonly logger = new Logger('ContractsService');
  private readonly structuredLogger = new StructuredLoggerService('ContractsService');
  constructor(
    private prisma: PrismaService,
    private query: ContractQueryService,
    private shopDownPaymentTemplate: ShopDownPaymentTemplate,
    private shopDownPaymentReversalTemplate: ShopDownPaymentReversalTemplate,
    private shopAccountResolver: ShopAccountResolver,
    private warrantyService?: WarrantyService,
    private audit?: AuditService,
  ) {}

  async create(dto: CreateContractDto, salespersonId: string, salespersonRole?: string, salespersonBranchId?: string | null) {
    const user = salespersonBranchId === undefined || !salespersonRole
      ? await this.prisma.user.findUnique({ where: { id: salespersonId }, select: { role: true, branchId: true } }) : null;
    const actor = { id: salespersonId, role: salespersonRole ?? user?.role ?? 'SALES',
      branchId: salespersonBranchId === undefined ? user?.branchId : salespersonBranchId };
    dto = { ...dto, sellingPrice: new Decimal(dto.sellingPrice).toDecimalPlaces(2).toNumber(),
      downPayment: new Decimal(dto.downPayment).toDecimalPlaces(2).toNumber() };
    const cashDown = dto.downPayment;
    const credits = new TradeInCreditService(this.prisma);
    const creditInput = { ...dto, tradeInId: dto.tradeInCreditId!, priceAfterDiscount: dto.sellingPrice };
    // Test-mode bypass: when the OWNER toggle is on, the contract-side credit
    // gate is skipped. Read once here (outside the retry loop) so retries don't
    // re-query and so audit is written at most once.
    const testModeOn = await this.query.isTestModeEnabled();

    // Create contract + payment schedule in transaction
    // Retry up to 3 times on unique constraint / serialization errors
    const MAX_RETRIES = 3;
    let contract;
    let creditGateBypassed = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        contract = await this.prisma.$transaction(async (tx) => {
          await lockCreditCustomer(tx, dto.customerId);
          await assertCustomerContractPolicy(tx, dto.customerId, actor.role, dto.overrideActiveContractCheck);
          const quote = await new ContractQuoteService(this.prisma).resolve(dto, actor, tx);
          if (dto.quoteFingerprint && dto.quoteFingerprint !== quote.fingerprint) {
            throw new ConflictException({ code: 'CONTRACT_QUOTE_CHANGED',
              message: 'เงื่อนไขผ่อนเปลี่ยนแล้ว กรุณาทบทวนยอดใหม่ก่อนยืนยัน', quote });
          }
          // ช่องรับเงินดาวน์: จ่ายผสมได้ โอน/QR บังคับเลขอ้างอิง — tender แรก = primary ที่ JE ดาวน์ลงเต็มยอด
          const downTenders = normalizeTenders(dto.tenders, quote.cashDownPayment, { method: dto.downPaymentMethod, reference: dto.downPaymentReference });
          const tender = contractDownTender(downTenders);
          // Verify credit check inside transaction for atomicity
          const approvedCreditCheck = await tx.creditCheck.findFirst({
            where: { customerId: dto.customerId, status: 'APPROVED', checkType: 'FULL', contractId: null, deletedAt: null },
            orderBy: { createdAt: 'desc' },
          });
          // Honor test-mode: only throw when there's no approved credit check
          // AND test-mode is OFF. When bypassed, approvedCreditCheck stays null
          // and the downstream linking step below is skipped.
          if (!approvedCreditCheck && !testModeOn) {
            throw new BadRequestException('ลูกค้าต้องผ่านการตรวจเครดิตก่อนทำสัญญา');
          }
          creditGateBypassed = !approvedCreditCheck && testModeOn;

          // Verify product is still available inside transaction.
          // Phase 5 fix round 1 [Important 3]: `deletedAt: null` ต้องอยู่ในด่านนี้ด้วย ให้ตรง
          // กับด่านนอก tx ที่บรรทัด ~64 — asymmetry เดียวกับที่ `ContractWorkflowService.activate`
          // เพิ่งแก้ (Task 2): การลบที่แทรกเข้ามาระหว่างสองด่านจะหลุดด่านใน tx ซึ่งเป็นตาข่าย
          // สุดท้ายก่อนสร้างสัญญาบนเครื่องที่ IMEI หลุด unique index ไปแล้ว
          const currentProduct = await tx.product.findFirst({
            where: { id: dto.productId, deletedAt: null },
            // test-data fence ต้องเห็น PO ต้นทาง (อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบ)
            include: { po: { select: { poNumber: true } } },
          });
          if (!currentProduct) throw new BadRequestException('ไม่พบสินค้า');
          assertSaleProductEligible(currentProduct, dto.branchId, actor, dto.previouslyDamagedAcknowledged);
          if (!currentProduct.imeiSerial) throw new BadRequestException('สินค้าต้องมี IMEI/Serial Number');
          const customerData = await tx.customer.findUnique({ where: { id: dto.customerId, deletedAt: null } });
          if (!customerData) throw new BadRequestException('ไม่พบลูกค้า');
          assertCustomerHasPhone(customerData, 'ทำสัญญา');
          assertSameTestSide(customerData, currentProduct);
          const customerSnapshot = customerContractSnapshot(customerData);

          // Generate contract number
          const contractNumber = await generateContractNumber(tx);

          const newContract = await tx.contract.create({
            data: {
              contractNumber,
              customerId: dto.customerId,
              productId: dto.productId,
              bundleProductIds: normalizeBundleIds(dto.bundleProductIds),
              branchId: dto.branchId,
              salespersonId,
              planType: (dto.planType || 'STORE_DIRECT') as PlanType,
              sellingPrice: quote.sellingPrice,
              downPayment: quote.downPayment,
              ...tender,
              interestRate: quote.interestRate,
              totalMonths: dto.totalMonths,
              interestTotal: quote.interestTotal,
              financedAmount: quote.principal,
              storeCommission: quote.storeCommission,
              vatAmount: quote.vatAmount,
              vatPct: quote.effectiveVatPct,
              monthlyPayment: quote.monthlyPayment,
              status: 'DRAFT',
              workflowStatus: 'CREATING',
              notes: dto.notes,
              paymentDueDay: dto.paymentDueDay,
              interestConfigId: quote.configId,
              customerSnapshot,
            },
          });

          if (dto.tradeInCreditId) {
            const snapshot = await credits.claim(tx, { ...creditInput, target: { contractId: newContract.id }, cashAmount: cashDown, actorId: salespersonId });
            await tx.contract.update({ where: { id: newContract.id }, data: { tradeInCreditSnapshot: snapshot } });
            newContract.tradeInCreditSnapshot = snapshot;
          }
          const payments = contractQuotePayments(quote, newContract.id);
          // The amount gate always applies, including when the old status-only test gate is enabled.
          await claimCreditApproval(tx, { customerId: dto.customerId, contractId: newContract.id,
            creditApprovalId: dto.creditApprovalId, monthlyAmounts: payments.map(payment => Number(payment.amountDue)),
            paymentDueDay: dto.paymentDueDay, firstPaymentDue: payments[0]?.dueDate,
            actor });
          await tx.payment.createMany({ data: payments });

          // SHOP-side: record the down payment received at contract creation.
          const downPayment = cashDownPayment(newContract);
          if (downPayment.gt(0)) {
            const cashAccountCode = await this.shopAccountResolver.resolveInflowCashAccount(dto.branchId, tender.downPaymentMethod, tx);
            await this.shopDownPaymentTemplate.execute(
              {
                idempotencyKey: `shop-down-payment:${newContract.id}`,
                contractId: newContract.id,
                contractNumber: newContract.contractNumber,
                cashAccountCode,
                downAmount: downPayment,
              },
              tx,
            );
            // สมุดเงินหน้าร้าน + JE แยกยอดของบิลจ่ายผสม — ผู้รับเงินดาวน์ = ผู้ใช้ที่กดสร้างสัญญา (บันทึกถาวร
            // ไม่เปลี่ยนตาม salespersonId ของสัญญา)
            await new ShopTenderRecorder(this.prisma, { accounts: this.shopAccountResolver }).recordInflow(tx, { kind: 'CONTRACT_DOWN', branchId: dto.branchId,
              actorId: actor.id, doc: { contractId: newContract.id }, docNumber: newContract.contractNumber, tenders: downTenders });
          }

          // Reserve product
          await tx.product.update({
            where: { id: dto.productId },
            data: { status: 'RESERVED' },
          });
          // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (กันขายซ้ำ)
          await preemptReservationsInTx(tx, [dto.productId]);
          // ของแถมเดินตามเครื่องหลัก: จองใน tx เดียวกัน (ตรวจหมวด/สาขา/รั้วข้อมูลทดสอบข้างใน)
          await reserveContractBundles(tx, {
            bundleProductIds: dto.bundleProductIds ?? [],
            mainProductId: dto.productId,
            branchId: dto.branchId,
            actor,
            customer: customerData,
            previouslyDamagedAcknowledged: dto.previouslyDamagedAcknowledged,
          });

          // claimCreditApproval linked the check atomically with its single-use approval.

          return newContract;
        }, { timeout: 15000, isolationLevel: 'Serializable' });
        break; // success — exit retry loop
      } catch (err: unknown) {
        // Retry on unique constraint (P2002) or serialization failure (P2034)
        const prismaErr = err instanceof Prisma.PrismaClientKnownRequestError ? err : null;
        const isRetryable = isRetryablePrismaWriteError(err);
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          continue;
        }
        if (isRetryable && prismaErr?.code !== 'P2002') {
          throw new ConflictException('มีรายการอื่นเปลี่ยนข้อมูลพร้อมกัน กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง');
        }
        if (err instanceof HttpException) {
          throw err;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        this.logger.error(`Failed to create contract (attempt ${attempt + 1}/${MAX_RETRIES}): [${prismaErr?.code}] ${errMsg}`, errStack);

        // Provide specific error messages for known Prisma errors
        if (prismaErr) {
          switch (prismaErr.code) {
            case 'P2002':
              throw new BadRequestException('เลขสัญญาซ้ำ กรุณาลองใหม่อีกครั้ง');
            case 'P2003': {
              const field = (prismaErr.meta?.field_name as string) || '';
              if (field.includes('branch')) throw new BadRequestException('ไม่พบสาขาที่เลือก');
              if (field.includes('customer')) throw new BadRequestException('ไม่พบข้อมูลลูกค้า');
              if (field.includes('product')) throw new BadRequestException('ไม่พบสินค้าที่เลือก');
              if (field.includes('salesperson') || field.includes('user')) throw new BadRequestException('ไม่พบข้อมูลพนักงานขาย');
              // Don't expose internal field names to the client
              this.logger.error(`FK violation on field: ${field}`);
              throw new BadRequestException('ข้อมูลอ้างอิงไม่ถูกต้อง');
            }
            case 'P2025':
              throw new BadRequestException('ไม่พบข้อมูลที่ต้องการอัปเดต (อาจถูกลบแล้ว)');
            case 'P2028':
              throw new BadRequestException('การทำรายการหมดเวลา กรุณาลองใหม่อีกครั้ง');
          }
        }

        this.logger.error(`Contract creation failed: ${errMsg}`, errStack);
        throw new InternalServerErrorException('ไม่สามารถสร้างสัญญาได้ กรุณาลองใหม่อีกครั้ง');
      }
    }

    const created = await this.query.findOne(contract!.id);

    // Audit the test-mode credit-gate bypass (best-effort; AuditService no-ops
    // without a userId). salespersonId is the actor that created the contract.
    if (creditGateBypassed && this.audit) {
      await this.audit.log({
        userId: salespersonId,
        action: 'CONTRACT_CREDIT_GATE_BYPASSED_TEST_MODE',
        entity: 'contract',
        entityId: created.id,
        newValue: { customerId: dto.customerId, reason: 'TEST_MODE_BYPASS' },
      });
    }

    if (cashDown > 0 && dto.downPaymentMethod == null && this.audit) {
      await this.audit.log({ userId: salespersonId, action: 'CONTRACT_DOWN_METHOD_DEFAULTED', entity: 'contract',
        entityId: created.id, newValue: { method: 'CASH', source: 'LEGACY_CREATE_CALLER' } });
    }

    // Auto-set shop warranty for used phones (fire-and-forget)
    if (this.warrantyService) {
      this.warrantyService.setShopWarranty(created.id).catch((err) =>
        this.logger.error('Failed to set shop warranty', err),
      );
    }

    this.structuredLogger.log('contract.created', {
      contractId: created.id,
      contractNumber: created.contractNumber,
      customerId: created.customerId,
      productId: created.productId,
      branchId: created.branchId,
      sellingPrice: Number(created.sellingPrice),
      downPayment: Number(created.downPayment),
      financedAmount: Number(created.financedAmount),
      totalMonths: created.totalMonths,
      monthlyPayment: Number(created.monthlyPayment),
      salespersonId,
    });
    return created;
  }

  // === UPDATE: แก้ไขรายละเอียดสัญญา (เฉพาะ CREATING/REJECTED) ===
  /**
   * แก้ไขของแถมของสัญญา — ได้จนกว่าจะเปิดใช้ (status = DRAFT ทุก workflowStatus).
   * กว้างกว่า `update()` ที่ล็อกหลังส่งตรวจ โดยตั้งใจ: ของแถมราคา 0 บาท ไม่กระทบยอด/ตารางผ่อน/ลายเซ็น
   * และทางเลือกอื่นของพนักงานที่ลืมใส่คือ "ลบร่างแล้วสร้างใหม่" ซึ่ง (ก) ลบได้เฉพาะ OWNER
   * (ข) สิทธิ์อนุมัติเครดิตที่ใช้ไปแล้วใช้ซ้ำไม่ได้. หลังเปิดใช้ล็อก — ต้นทุนของแถมลงบัญชีไปแล้ว
   *
   * ขอบเขตสิทธิ์อยู่ที่นี่ ไม่ใช่ guard (route รูป /:id ไม่มี branchId ให้ BranchGuard ตรวจ):
   * OWNER ทุกสัญญา · BRANCH_MANAGER เฉพาะสาขาตัวเอง (ไม่มี branchId = fail-closed) · SALES เฉพาะสัญญาที่ตัวเองสร้าง
   */
  async updateBundles(
    id: string,
    bundleProductIds: string[],
    actor: { id: string; role: string; branchId?: string | null },
  ) {
    const next = normalizeBundleIds(bundleProductIds);
    if (next.length > MAX_CONTRACT_BUNDLES) {
      throw new BadRequestException(`ของแถมต่อสัญญาได้ไม่เกิน ${MAX_CONTRACT_BUNDLES} ชิ้น`);
    }
    await this.prisma.$transaction(async (tx) => {
      // ล็อกแถวสัญญา — แก้ของแถมพร้อมกันสองคำขอเป็น read-modify-write บนคอลัมน์เดียว
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${id} FOR UPDATE`;
      const contract = await tx.contract.findFirst({ where: { id, deletedAt: null } });
      if (!contract) throw new NotFoundException('ไม่พบสัญญา');
      if (actor.role === 'BRANCH_MANAGER' && (!actor.branchId || actor.branchId !== contract.branchId)) {
        throw new ForbiddenException('แก้ไขของแถมได้เฉพาะสัญญาของสาขาตัวเอง');
      }
      if (actor.role === 'SALES' && contract.salespersonId !== actor.id) {
        throw new ForbiddenException('แก้ไขของแถมได้เฉพาะสัญญาที่ตัวเองสร้าง');
      }
      if (contract.status !== 'DRAFT') {
        throw new BadRequestException('แก้ไขของแถมได้เฉพาะก่อนเปิดใช้สัญญา — สัญญานี้เปิดใช้แล้ว ต้นทุนของแถมลงบัญชีไปแล้ว');
      }

      const current = contract.bundleProductIds ?? [];
      const removed = current.filter((pid) => !next.includes(pid));
      const added = next.filter((pid) => !current.includes(pid));
      if (!removed.length && !added.length) return;

      await releaseContractBundles(tx, removed);
      if (added.length) {
        const customer = await tx.customer.findUnique({
          where: { id: contract.customerId },
          select: TEST_SIDE_CUSTOMER_SELECT,
        });
        if (!customer) throw new BadRequestException('ไม่พบลูกค้า');
        await reserveContractBundles(tx, {
          bundleProductIds: added,
          mainProductId: contract.productId,
          branchId: contract.branchId,
          actor,
          customer,
        });
      }
      await tx.contract.update({ where: { id }, data: { bundleProductIds: next } });
      // atomic กับการ flip สถานะสินค้า (กติกา AuditLog ใน .claude/rules/database.md) — rollback แล้วต้องไม่เหลือแถว
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CONTRACT_BUNDLES_UPDATED',
          entity: 'contract',
          entityId: id,
          oldValue: { bundleProductIds: current },
          newValue: { bundleProductIds: next, added, removed, contractNumber: contract.contractNumber },
        },
      });
    });
    return this.query.findOne(id);
  }

  async update(id: string, dto: UpdateContractDto, userId: string) {
    const initial = await this.query.findOne(id);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, branchId: true } });
    if (initial.salespersonId !== userId && user?.role !== 'OWNER') {
      throw new ForbiddenException('เฉพาะพนักงานที่สร้างสัญญาเท่านั้นที่สามารถแก้ไขได้');
    }
    await this.prisma.$transaction(async (tx) => {
      await lockCreditCustomer(tx, initial.customerId);
      const contract = await tx.contract.findUniqueOrThrow({ where: { id, deletedAt: null } });
      if (contract.status !== 'DRAFT' || !['CREATING', 'REJECTED'].includes(contract.workflowStatus)) {
        throw new BadRequestException('แก้ไขได้เฉพาะสัญญาฉบับร่างที่กำลังสร้างหรือถูกปฏิเสธ');
      }
      if (contract.tradeInCreditSnapshot && Object.keys(dto).some(key => key !== 'notes')) {
        throw new BadRequestException('สัญญาที่ใช้เครดิตเทิร์นแก้ยอดไม่ได้ กรุณายกเลิกฉบับร่างแล้วสร้างใหม่');
      }
      const changed = (['sellingPrice', 'downPayment', 'totalMonths', 'interestRate', 'paymentDueDay'] as const)
        .some(key => dto[key] !== undefined && Number(dto[key]) !== Number(contract[key]));
      if (!changed) {
        await tx.contract.update({ where: { id }, data: { ...(dto.notes !== undefined ? { notes: dto.notes } : {}) } });
        return;
      }
      const paymentCount = await tx.payment.count({ where: { contractId: id, deletedAt: null } });
      if (paymentCount > 0) throw new BadRequestException('ไม่สามารถแก้ไขเงื่อนไขทางการเงินได้ เนื่องจากมีตารางผ่อนชำระแล้ว กรุณาสร้างสัญญาใหม่แทน');
      // Receiving down is a ledger event; changing a draft cannot silently change that receipt.
      if (dto.downPayment !== undefined && Number(dto.downPayment) !== Number(contract.downPayment) &&
        (contract.downPaymentReceivedAt || await tx.journalEntry.findFirst({ where: {
          deletedAt: null, metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${id}` },
        }, select: { id: true } }))) {
        throw new BadRequestException('สัญญานี้บันทึกรับเงินดาวน์แล้ว กรุณายกเลิกฉบับร่างแล้วสร้างใหม่');
      }
      const quote = await new ContractQuoteService(this.prisma).resolve({
        customerId: contract.customerId, productId: contract.productId, branchId: contract.branchId,
        sellingPrice: dto.sellingPrice ?? Number(contract.sellingPrice), downPayment: dto.downPayment ?? Number(contract.downPayment),
        totalMonths: dto.totalMonths ?? contract.totalMonths, paymentDueDay: dto.paymentDueDay ?? contract.paymentDueDay ?? undefined,
        interestRate: dto.interestRate ?? Number(contract.interestRate),
      }, { id: userId, role: user?.role ?? 'SALES', branchId: user?.branchId }, tx);
      const payments = contractQuotePayments(quote, id);
      await assertContractCreditApproval(tx, { customerId: contract.customerId, contractId: id,
        monthlyAmounts: payments.map(row => Number(row.amountDue)), paymentDueDay: dto.paymentDueDay ?? contract.paymentDueDay,
        firstPaymentDue: payments[0]?.dueDate });
      await tx.contract.update({ where: { id }, data: {
        sellingPrice: quote.sellingPrice, downPayment: quote.downPayment, totalMonths: quote.totalMonths,
        interestRate: quote.interestRate, interestTotal: quote.interestTotal, financedAmount: quote.principal,
        storeCommission: quote.storeCommission, vatAmount: quote.vatAmount, vatPct: quote.effectiveVatPct,
        monthlyPayment: quote.monthlyPayment, interestConfigId: quote.configId,
        paymentDueDay: dto.paymentDueDay ?? contract.paymentDueDay,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      } });
      await tx.payment.createMany({ data: payments });
    }, { isolationLevel: 'Serializable' });
    return this.query.findOne(id);
  }

  // === SOFT DELETE: ลบสัญญา (เฉพาะ CREATING/REJECTED, ห้ามลบสัญญาที่ลงนามแล้ว) ===
  async softDelete(id: string, userId: string) {
    let contract = await this.query.findOne(id);

    // T5-C2 — Explicit terminal-status lockdown. Once a contract leaves DRAFT
    // (activation, payoff, repossession, bad-debt close-out, etc.) it becomes
    // a legal/financial record and MUST NOT be deletable — even if workflow
    // drift left it in an unexpected state. Only DRAFT is mutable.
    const immutableStatuses: string[] = [
      'ACTIVE',
      'OVERDUE',
      'DEFAULT',
      'EARLY_PAYOFF',
      'COMPLETED',
      'EXCHANGED',
      'DEFECT_EXCHANGED',
      'CLOSED_BAD_DEBT',
    ];
    if (immutableStatuses.includes(contract.status)) {
      throw new BadRequestException(
        `ไม่สามารถลบสัญญาที่อยู่ในสถานะ ${contract.status} ได้ — ` +
        'สัญญาที่เปิดใช้งานหรือปิดรายการแล้วเป็นหลักฐานทางการเงินและทางกฎหมาย ห้ามลบเด็ดขาด',
      );
    }

    // Beyond the terminal-status check, still require workflow to be
    // CREATING/REJECTED (i.e. not already submitted/approved).
    if (contract.status !== 'DRAFT' ||
        (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED')) {
      throw new BadRequestException(
        'ลบได้เฉพาะสัญญาที่อยู่ในสถานะ DRAFT + กำลังสร้าง/ถูกปฏิเสธ เท่านั้น ' +
        '(สัญญาที่ลงนามแล้วห้ามลบเด็ดขาด ใช้ soft delete เท่านั้น)',
      );
    }

    // Signatures on an ACTIVE/signed-but-pending contract are eIDAS evidence —
    // cannot be erased. BUT a REJECTED workflow means manager voided the
    // contract before activation; any signatures collected beforehand have no
    // legal force. Cascade soft-delete them (row retained for audit).
    const hasSignatures = contract.signatures && contract.signatures.length > 0;
    if (hasSignatures && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException(
        'ไม่สามารถลบสัญญาที่มีลายเซ็นแล้ว — ' +
          'อนุญาตเฉพาะสัญญาที่ถูกปฏิเสธ (workflowStatus = REJECTED) เท่านั้น',
      );
    }

    const now = new Date();
    const cascadedSignatures = hasSignatures ? contract.signatures.length : 0;

    await this.prisma.$transaction(async (tx) => {
      await lockCreditCustomer(tx, contract.customerId);
      const current = await tx.contract.findUnique({ where: { id, deletedAt: null }, include: { signatures: { where: { deletedAt: null } } } });
      if (!current || current.status !== 'DRAFT' || !['CREATING', 'REJECTED'].includes(current.workflowStatus) ||
        (current.signatures.length > 0 && current.workflowStatus !== 'REJECTED')) {
        throw new BadRequestException('สัญญาเปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลใหม่ก่อนลบ');
      }
      contract = { ...contract, ...current };
      // Reverse the SHOP down-payment JE if one was posted for this DRAFT contract.
      const downPayment = cashDownPayment(contract);
      await cleanupCreditContractSale(tx, contract, userId, 'ยกเลิกสัญญาใช้เครดิตเทิร์น');
      await new TradeInCreditService(this.prisma).release(tx, contract.tradeInCreditSnapshot,
        { contractId: id }, userId, 'ลบสัญญาฉบับร่าง', true);
      if (downPayment.gt(0)) {
        const downJe = await tx.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'shop-down-payment' } as any },
              { metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${id}` } as any },
            ],
            deletedAt: null,
          },
          select: { id: true, lines: { where: { deletedAt: null, debit: { gt: 0 } }, select: { accountCode: true, debit: true } } },
        });
        if (downJe) {
          const receipt = downJe.lines.filter(line => line.accountCode.startsWith('S11-') && line.debit.eq(downPayment));
          if (receipt.length !== 1) throw new BadRequestException('ไม่พบบัญชีรับดาวน์เดิมที่ตรงยอด กรุณาตรวจหลักฐานการรับเงิน');
          const refundAccountCode = receipt[0].accountCode;
          await this.shopDownPaymentReversalTemplate.execute(
            {
              idempotencyKey: `shop-down-payment-reversal:${id}`,
              contractId: id,
              contractNumber: contract.contractNumber,
              refundAccountCode,
              downAmount: downPayment,
              originalJournalEntryId: downJe.id,
            },
            tx,
          );
          // คืนเงินตามวิธีที่รับมา: reversal ข้างบนคืนเต็มยอดเข้าบัญชี primary — ดาวน์จ่ายผสมต้อง mirror JE
          // แยกยอดด้วย (ไม่งั้นบัญชี primary ติดลบเท่าส่วนของวิธีอื่น) · แถว OUT = ผู้กดลบร่าง
          await new ShopTenderRecorder(this.prisma).recordRefund(tx, { doc: { contractId: id }, kinds: ['CONTRACT_DOWN'],
            actorId: userId, reverseSplitJe: true, descriptionPrefix: '[ลบร่างสัญญา]', occurredAt: now });
        }
      }

      await tx.contract.update({ where: { id }, data: { deletedAt: now } });
      // Cascade soft-delete signatures only when the contract is REJECTED.
      // No-op when there are no signatures (unsigned drafts).
      if (cascadedSignatures > 0) {
        await tx.signature.updateMany({
          where: { contractId: id, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      // Unlink the document for a new review. The old approval remains consumed
      // by this deleted contract and can never be claimed a second time.
      await tx.creditCheck.updateMany({
        where: { contractId: id },
        data: { contractId: null },
      });
      // KYC records captured for this contract (OTP + ID card photo) become
      // orphans otherwise. Soft-delete keeps the row for audit but marks it
      // as no-longer-tied-to-an-active-contract.
      await tx.kycVerification.updateMany({
        where: { contractId: id, deletedAt: null },
        data: { deletedAt: now },
      });
      // Release reserved product back to IN_STOCK
      await tx.product.updateMany({
        where: { id: contract.productId, status: 'RESERVED' },
        data: { status: 'IN_STOCK' },
      });
      // ของแถมที่จองไว้กับร่างนี้กลับเป็นพร้อมขายพร้อมเครื่องหลัก
      await releaseContractBundles(tx, contract.bundleProductIds ?? []);
      await tx.auditLog.create({
        data: {
          userId,
          action: 'CONTRACT_DELETE',
          entity: 'contract',
          entityId: id,
          oldValue: {
            contractNumber: contract.contractNumber,
            status: contract.status,
            workflowStatus: contract.workflowStatus,
          },
          newValue: {
            cascadedSignatures,
          },
        },
      });
    });

    return {
      message:
        cascadedSignatures > 0
          ? `ลบสัญญาเรียบร้อย (soft delete) พร้อมลายเซ็น ${cascadedSignatures} รายการ`
          : 'ลบสัญญาเรียบร้อย (soft delete)',
    };
  }

  /**
   * T4-C1 — Reassign salesperson after contract is created.
   *
   * Salesperson identity ties to commission payout and audit trail. Once a
   * contract is APPROVED or has any `Signature` row, the salesperson
   * attribution is effectively locked: changing it would rewrite a historical
   * fact (who sold what, who gets the commission, whose signature witnessed
   * the customer's). We therefore reject reassignment in those cases, with
   * an OWNER-only override (logged to AuditLog, commission recalc must be
   * scheduled separately).
   *
   * @param contractId      contract to update
   * @param newSalespersonId  user id of the new salesperson
   * @param actor           the user performing the change (with role)
   */
  async updateSalesperson(
    contractId: string,
    newSalespersonId: string,
    actor: { id: string; role: string },
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: { select: { id: true } } },
    });
    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    // Verify the new salesperson exists and is active
    const newSalesperson = await this.prisma.user.findUnique({
      where: { id: newSalespersonId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!newSalesperson || newSalesperson.deletedAt) {
      throw new BadRequestException('ไม่พบพนักงานขายที่เลือก');
    }

    // No-op
    if (contract.salespersonId === newSalespersonId) {
      return { message: 'พนักงานขายเดิมอยู่แล้ว ไม่มีการเปลี่ยนแปลง', contractId };
    }

    const hasSignatures = (contract.signatures?.length ?? 0) > 0;
    const isApproved = contract.workflowStatus === 'APPROVED';
    const isLocked = isApproved || hasSignatures;

    if (isLocked && actor.role !== 'OWNER') {
      throw new ForbiddenException(
        'ไม่สามารถเปลี่ยนพนักงานขายได้ เนื่องจากสัญญาถูกอนุมัติหรือลงนามแล้ว ' +
        '(เฉพาะ OWNER เท่านั้นที่มีสิทธิ์แก้ไข)',
      );
    }

    const previousSalespersonId = contract.salespersonId;

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contractId },
        data: { salespersonId: newSalespersonId },
      });

      // Audit trail — required whenever a locked contract is overridden by OWNER,
      // and cheap/useful even for the unlocked DRAFT path.
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE_SALESPERSON',
          entity: 'contract',
          entityId: contractId,
          oldValue: { salespersonId: previousSalespersonId },
          newValue: {
            salespersonId: newSalespersonId,
            overrideReason: isLocked ? 'OWNER_OVERRIDE_AFTER_LOCK' : 'PRE_APPROVAL_REASSIGN',
            workflowStatus: contract.workflowStatus,
            signatureCount: contract.signatures?.length ?? 0,
          },
        },
      });
    });

    this.structuredLogger.log('contract.salesperson.reassigned', {
      contractId,
      contractNumber: contract.contractNumber,
      previousSalespersonId,
      newSalespersonId,
      actorId: actor.id,
      actorRole: actor.role,
      wasLocked: isLocked,
    });

    // TODO(T4-C1): Commission recalculation is out of scope of this change.
    // When a locked contract's salesperson is reassigned by OWNER, any
    // already-posted commission attributions must be reversed on the
    // previous salesperson and re-accrued to the new salesperson.
    // Schedule this via CommissionService once the reconciliation flow is
    // designed (see docs/ceo-review/tier-8-fraud-heatmap-master.md §T4-C1).

    return this.query.findOne(contractId);
  }
}
