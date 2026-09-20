import { contractSignatureRequirements } from '../../utils/validation.util';
import { cashDownPayment } from '../trade-in/services/trade-in-credit.service';
import { Injectable, Logger, Optional, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateShort } from '../../utils/thai-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/notification-category.enum';
import {
  checkAgeEligibility,
  checkRequiredContractFields,
  checkRequiredDocuments,
  checkRequiredSignatures,
} from '../../utils/validation.util';
import { generateSaleNumber } from '../../utils/sequence.util';
import { buildInstallmentScheduleRows } from '../../utils/installment-schedule.util';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { resolveStoreCommission } from '../../utils/store-commission.util';
import { normalizeBundleIds, sellContractBundles } from './services/contract-bundle.util';
import { ensureContractCommission } from './services/contract-commission.util';
import { loadInstallmentConfig } from '../../utils/config.util';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ProductsService } from '../products/products.service';
import { closeRepossessionOnSale } from '../repossessions/repossession-resale.util';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';
import { TestModeService } from '../test-mode/test-mode.service';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';
import { CreditHistoryActor, visibleContractCredit } from '../credit-check/services/room-credit-access';
import { assertContractCreditApproval } from '../credit-check/services/credit-approval';
import { lockCreditCustomer } from '../credit-check/services/room-credit-history';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';

@Injectable()
export class ContractWorkflowService {
  private readonly logger = new Logger(ContractWorkflowService.name);
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private journalAutoService: JournalAutoService,
    private contractActivation1ATemplate: ContractActivation1ATemplate,
    private productsService: ProductsService,
    private contractExchangeService: ContractExchangeService,
    private shopInventoryTransferTemplate: ShopInventoryTransferTemplate,
    private shopDownPaymentTemplate: ShopDownPaymentTemplate,
    private shopAccountResolver: ShopAccountResolver,
    @Optional() private testMode?: TestModeService,
    // การเดินทางของลูกค้า (CONTRACT_REVIEWED) — @Optional: เทสเดิมประกอบ service ด้วย 9-10 อาร์กิวเมนต์
    // ContractsModule import CustomerJourneyModule อยู่แล้ว (ContractsController ฉีดแบบบังคับ ถ้าลืม import แอปจะบูตไม่ขึ้น)
    @Optional() private journeyEntries?: JourneyEntryWriter,
  ) {}

  /**
   * T5-C20: compute the integrity hash for a contract.
   *
   * Covers the core money + identity fields AND the "weak" supporting
   * evidence — notes (free text that salespeople occasionally edit post-hoc),
   * customer.nationalId (a later change points to identity substitution),
   * signatures (id/signerType/signedAt/staffUserId — a re-sign would shift
   * timestamps) and contract documents (id + fileHash — a swapped PDF would
   * keep the id but flip the fileHash).
   *
   * Signatures and documents are sorted by id so insertion order can't
   * silently change the hash.
   *
   * We intentionally DO NOT include signatureImage/signatureSvg in the hash —
   * those are base64/SVG blobs; downstream code sometimes re-serializes them
   * (PNG optimization, etc.) without changing their legal effect. The
   * Signature row's id + signedAt + staffUserId is the authoritative
   * "this signature happened" fingerprint.
   */
  private computeContractHash(contract: {
    tradeInCreditSnapshot?: Prisma.JsonValue;
    contractNumber: string;
    customerId: string;
    productId: string;
    sellingPrice: Prisma.Decimal | number | string;
    downPayment: Prisma.Decimal | number | string;
    totalMonths: number;
    monthlyPayment: Prisma.Decimal | number | string;
    notes?: string | null;
    customer?: { nationalId?: string | null } | null;
    signatures?: Array<{
      id?: string;
      signerType?: string;
      signedAt?: Date | string;
      staffUserId?: string | null;
    }> | null;
    contractDocuments?: Array<{
      id?: string;
      fileHash?: string | null;
    }> | null;
  }): string {
    // Defensive sort — older fixtures may not carry an id. Fallback to
    // signerType/signedAt so the ordering is still deterministic.
    const sigKey = (s: { id?: string; signerType?: string; signedAt?: Date | string }) =>
      s.id ?? `${s.signerType ?? ''}|${s.signedAt ?? ''}`;
    const signatures = (contract.signatures ?? [])
      .slice()
      .sort((a, b) => sigKey(a).localeCompare(sigKey(b)))
      .map((s) => ({
        id: s.id ?? null,
        signerType: s.signerType,
        signedAt:
          s.signedAt instanceof Date
            ? s.signedAt.toISOString()
            : s.signedAt != null
              ? String(s.signedAt)
              : null,
        staffUserId: s.staffUserId ?? null,
      }));

    const docKey = (d: { id?: string; fileHash?: string | null }) =>
      d.id ?? d.fileHash ?? '';
    const documents = (contract.contractDocuments ?? [])
      .slice()
      .sort((a, b) => docKey(a).localeCompare(docKey(b)))
      .map((d) => ({ id: d.id ?? null, fileHash: d.fileHash ?? null }));

    // Decimal/number/string → string so we don't depend on JSON's numeric
    // formatting (1.00 vs 1 would otherwise hash differently).
    const asStr = (v: Prisma.Decimal | number | string) =>
      typeof v === 'string' ? v : v.toString();

    const payload = JSON.stringify({
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      productId: contract.productId,
      sellingPrice: asStr(contract.sellingPrice),
      downPayment: asStr(contract.downPayment),
      totalMonths: contract.totalMonths,
      monthlyPayment: asStr(contract.monthlyPayment),
      notes: contract.notes ?? null,
      customerNationalId: contract.customer?.nationalId ?? null,
      signatures,
      documents,
      ...(contract.tradeInCreditSnapshot ? { tradeInCreditSnapshot: contract.tradeInCreditSnapshot } : {}),
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * T5-C20: re-validate the stored contractHash against the current state.
   * Throws BadRequestException (Thai message) on mismatch. Called at every
   * post-submit state transition (APPROVED, ACTIVE) so silent edits to
   * notes / docs / signatures are caught before money moves.
   */
  private verifyContractHash(
    contract: Parameters<ContractWorkflowService['computeContractHash']>[0] & {
      contractHash?: string | null;
    },
    transition: string,
  ): void {
    if (!contract.contractHash) return; // legacy contracts without hash — skip
    const current = this.computeContractHash(contract);
    if (current !== contract.contractHash) {
      this.logger.warn(
        `Contract hash mismatch on ${transition} — expected=${contract.contractHash} actual=${current}`,
      );
      throw new BadRequestException(
        'ข้อมูลสัญญาถูกแก้ไขหลังส่งตรวจสอบ — contractHash ไม่ตรงกัน กรุณาส่งตรวจใหม่',
      );
    }
  }

  // === WORKFLOW: ส่งตรวจสอบ (ตรวจ Validation ทั้งหมดก่อนส่ง) ===
  async submitForReview(id: string, userId: string, userRole = 'SALES') {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ กำลังสร้าง หรือ ปฏิเสธ เท่านั้น');
    }

    // Only the salesperson who created it can submit
    if (contract.salespersonId !== userId) {
      throw new ForbiddenException('เฉพาะพนักงานที่สร้างสัญญาเท่านั้นที่สามารถส่งตรวจสอบ');
    }

    // Enforce mandatory steps before submit
    const isDev = process.env.NODE_ENV !== 'production';
    // Bypass the credit gate in dev OR when the OWNER test-mode toggle is on.
    // Fail-safe: if TestModeService isn't wired in or the read throws, the read
    // returns false so the production gate stays active.
    const testModeOn = this.testMode ? await this.testMode.isEnabled() : false;
    const creditGateBypass = isDev || testModeOn;

    // Step 1: Credit check must be approved
    if (!contract.creditCheck || contract.creditCheck.status !== 'APPROVED') {
      if (creditGateBypass) {
        this.logger.warn(`[DEV] Skipping credit check requirement for contract ${id}`);
      } else {
        throw new BadRequestException('ต้องผ่านการตรวจเครดิตก่อนส่งตรวจสอบ (ขั้นตอนที่ 1)');
      }
    }

    // Step 2: Required fields validation
    const customer = contract.customer;
    const product = contract.product;
    const missingFields = checkRequiredContractFields({
      customerName: customer?.name,
      customerNationalId: customer?.nationalId,
      customerPhone: customer?.phone,
      customerAddressIdCard: customer?.addressIdCard,
      customerAddressCurrent: customer?.addressCurrent,
      references: customer?.references as Prisma.JsonArray,
      productName: product?.name,
      productImei: product?.imeiSerial,
      sellingPrice: Number(contract.sellingPrice),
      downPayment: Number(contract.downPayment),
      totalMonths: contract.totalMonths,
      monthlyPayment: Number(contract.monthlyPayment),
    });
    if (missingFields.length > 0) {
      if (isDev) {
        this.logger.warn(`[DEV] Skipping required fields check: ${missingFields.join(', ')}`);
      } else {
        throw new BadRequestException(`ข้อมูลสัญญาไม่ครบ: ${missingFields.join(', ')} (ขั้นตอนที่ 2)`);
      }
    }

    // Step 3: PDPA consent
    if (!contract.pdpaConsentId) {
      if (isDev) {
        this.logger.warn(`[DEV] Skipping PDPA consent requirement for contract ${id}`);
      } else {
        throw new BadRequestException('ต้องได้รับความยินยอม PDPA จากลูกค้าก่อน (ขั้นตอนที่ 3)');
      }
    }

    // Step 5: Signatures (at minimum customer + company)
    const customerSigned = contract.signatures?.some((s: { signerType: string }) =>
      s.signerType === 'CUSTOMER'
    );
    const companySigned = contract.signatures?.some((s: { signerType: string }) =>
      s.signerType === 'COMPANY' || s.signerType === 'STAFF'
    );
    if (!customerSigned || !companySigned) {
      throw new BadRequestException('ต้องลงนามครบทั้งลูกค้าและผู้ขายก่อนส่งตรวจสอบ (ขั้นตอนที่ 5)');
    }

    // T5-C20: extended integrity hash — covers notes, customer nationalId,
    // signatures (id+type+timestamp+staff), and document fileHashes in
    // addition to the core money fields.
    const contractHash = this.computeContractHash(contract);

    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'PENDING_REVIEW',
        contractHash,
        // Set legal clause flags
        hasOwnershipClause: true,
        hasRepossessionClause: true,
        hasEarlyPayoffClause: true,
        hasNoTransferClause: true,
        hasAcknowledgement: true,
      },
    });

    return this.findOne(id, { id: userId, role: userRole });
  }

  // === WORKFLOW: อนุมัติสัญญา (ตรวจเอกสารครบก่อนอนุมัติ) ===
  async approveContract(id: string, userId: string, userRole: string, reviewNotes?: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'PENDING_REVIEW') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ รอตรวจสอบ');
    }

    // T5-C20: verify extended hash — detects post-submit edits to notes,
    // customer nationalId, signatures or document contents as well as the
    // core money fields.
    this.verifyContractHash(contract, 'APPROVED');

    // Prevent self-approval: salesperson cannot approve their own contract
    // Exception: OWNER can always approve (for small business where owner is also salesperson)
    if (contract.salespersonId === userId && userRole !== 'OWNER') {
      throw new ForbiddenException('ไม่สามารถอนุมัติสัญญาที่ตัวเองสร้างได้');
    }

    // Check age for guardian requirement
    let requiresGuardian = false;
    if (contract.customer?.birthDate) {
      const ageCheck = checkAgeEligibility(new Date(contract.customer.birthDate));
      requiresGuardian = ageCheck.requiresGuardian;
    }

    // Step 7: Manager ตรวจสอบเอกสารครบ
    const docCheck = checkRequiredDocuments(
      contract.contractDocuments || [],
      requiresGuardian,
    );
    if (!docCheck.complete) {
      const missing = docCheck.checklist
        .filter((c) => !c.present)
        .map((c) => c.label);
      throw new BadRequestException(`เอกสารไม่ครบ ไม่สามารถอนุมัติได้: ${missing.join(', ')}`);
    }

    // Check signatures completeness
    const sigCheck = checkRequiredSignatures(
      contract.signatures || [],
      requiresGuardian,
    );
    if (!sigCheck.complete) {
      const missing = sigCheck.checklist
        .filter((c) => !c.signed)
        .map((c) => c.label);
      throw new BadRequestException(`ลายเซ็นไม่ครบ ไม่สามารถอนุมัติได้: ${missing.join(', ')}`);
    }

    const reviewedAt = new Date();
    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'APPROVED',
        reviewedById: userId,
        reviewedAt,
        reviewNotes,
      },
    });
    await this.recordReviewRound(contract, 'APPROVED', userId, reviewedAt);

    return this.findOne(id);
  }

  // === WORKFLOW: ปฏิเสธสัญญา ===
  async rejectContract(id: string, userId: string, userRole: string, reviewNotes: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'PENDING_REVIEW') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ รอตรวจสอบ');
    }

    // OWNER can always reject (for small business where owner is also salesperson)
    if (contract.salespersonId === userId && userRole !== 'OWNER') {
      throw new ForbiddenException('ไม่สามารถปฏิเสธสัญญาที่ตัวเองสร้างได้');
    }

    const reviewedAt = new Date();
    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'REJECTED',
        reviewedById: userId,
        reviewedAt,
        reviewNotes,
      },
    });
    await this.recordReviewRound(contract, 'REJECTED', userId, reviewedAt);

    return this.findOne(id);
  }

  /**
   * การเดินทางของลูกค้า — contracts.reviewedAt/workflowStatus ถูกเขียนทับทุกรอบ เหลือแค่รอบล่าสุด
   * ⇒ เก็บทุกรอบเป็น entry หลัง update สำเร็จ (update เดี่ยว = commit แล้ว) · dedupeKey ผูกเวลาของรอบ
   * ไม่คัดลอก reviewNotes: ข้อความอิสระอาจมีเบอร์/ที่อยู่ และคอลัมน์ data ถูก grant ให้ MCP
   * recordAfterCommit ไม่โยน error ⇒ การอนุมัติ/ตีกลับไม่มีทางล้มเพราะบันทึกนี้
   */
  private async recordReviewRound(
    contract: { id: string; customerId: string; contractNumber: string },
    decision: 'APPROVED' | 'REJECTED',
    userId: string,
    reviewedAt: Date,
  ): Promise<void> {
    if (!this.journeyEntries) return;
    await this.journeyEntries.recordAfterCommit({
      customerId: contract.customerId,
      kind: 'CONTRACT_REVIEWED',
      occurredAt: reviewedAt,
      actorType: 'STAFF',
      actorUserId: userId,
      refType: 'contract',
      refId: contract.id,
      data: { decision, contractNumber: contract.contractNumber },
      dedupeKey: journeyDedupeKey('CONTRACT_REVIEWED', contract.id, reviewedAt.toISOString()),
    });
  }

  async activate(id: string) {
    const contract = await this.findOne(id);

    // Must be APPROVED workflow and DRAFT status
    if (contract.workflowStatus !== 'APPROVED') {
      throw new BadRequestException('สัญญาต้องได้รับการอนุมัติก่อนเปิดใช้งาน');
    }
    if (contract.status !== 'DRAFT') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ DRAFT');
    }

    // Verify PDPA consent exists (compliance: พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562)
    if (!contract.pdpaConsentId) {
      throw new BadRequestException('ต้องได้รับความยินยอม PDPA ก่อนเปิดใช้งานสัญญา');
    }

    // T5-C20: re-verify integrity hash before activation. Approval already
    // checked it, but documents/signatures can still drift between approve
    // and activate — activate is where money/ownership moves so a second
    // check is cheap insurance.
    this.verifyContractHash(contract, 'ACTIVE');

    const signatureRequirements = contractSignatureRequirements(contract);
    const missingSigners = signatureRequirements.checklist.filter(row => !row.signed);
    if (missingSigners.some(row => ['CUSTOMER', 'COMPANY'].includes(row.type))) {
      throw new BadRequestException('ต้องลงนามครบทั้งผู้ซื้อและผู้ขายก่อนเปิดใช้งานสัญญา');
    }
    if (missingSigners.some(row => ['WITNESS_1', 'WITNESS_2'].includes(row.type))) {
      throw new BadRequestException('ต้องมีพยานลงนามครบ 2 คนก่อนเปิดใช้งานสัญญา');
    }
    if (missingSigners.length) throw new BadRequestException('ลูกค้าอายุต่ำกว่า 20 ปี ต้องมีผู้ปกครองลงนาม');

    // Verify product is still reserved for this contract.
    // Phase 5 Task 2: `deletedAt: null` เป็นส่วนหนึ่งของด่าน — สถานะสินค้ากับการถูกลบเป็นคนละ
    // มิติกัน เครื่องที่ถูก soft-delete ยังค้างสถานะ RESERVED/IN_STOCK ได้ (ลบไม่ได้ล้างสถานะ)
    // ⇒ `findUnique({ id })` เดิมปล่อยให้เปิดสัญญาบนเครื่องที่หลุด partial unique index
    // `products_imei_serial_active_unique` ไปแล้ว = รับ IMEI เดิมเข้าสต็อกซ้ำแล้วขายซ้ำได้
    const product = await this.prisma.product.findFirst({
      where: { id: contract.productId, deletedAt: null },
    });
    if (!product || (product.status !== 'RESERVED' && product.status !== 'IN_STOCK')) {
      throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
    }

    // F-3-027 part 2/3: HP receivable + interest income are FINANCE-side accounts.
    // Resolve FINANCE companyId BEFORE the transaction so it can be passed
    // explicitly to the activation JE (instead of relying on the non-deterministic
    // resolveCompanyId fallback). Also reused below for product ownership transfer.
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    // Phase A.1b: contract activation now posts paired SHOP+FINANCE entries.
    // SHOP company is also required (Dr Cash + Dr Due-from-FINANCE / Cr Revenue + COGS).
    const shopCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!shopCompany) {
      throw new InternalServerErrorException('SHOP company not configured');
    }

    // SP2 sign-then-activate branch: if this contract was born from an
    // exchange request (exchangedFromContractId non-null), the activation
    // path swaps the normal ContractActivation1A JE + Sale-record creation
    // for the exchange-specific JE chain (A.1-A.4) + old-side flips. The
    // new contract still becomes ACTIVE and the new product still flips to
    // SOLD_INSTALLMENT + FINANCE ownership — that part is identical.
    //
    // Capture as a plain bool so the closure inside $transaction reads it
    // without re-deriving from the contract object.
    const isExchangeContract = !!(contract as any).exchangedFromContractId;

    await this.prisma.$transaction(async (tx) => {
      // Re-check product status inside transaction to prevent race condition
      await lockCreditCustomer(tx, contract.customerId);
      const current = await tx.contract.findUnique({ where: { id, deletedAt: null },
        include: { payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } } } });
      if (!current || current.status !== 'DRAFT' || current.workflowStatus !== 'APPROVED') {
        throw new BadRequestException('สัญญาเปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลใหม่');
      }
      await assertContractCreditApproval(tx, { customerId: current.customerId, contractId: id,
        paymentDueDay: current.paymentDueDay,
        monthlyAmounts: current.payments.map(payment => Number(payment.amountDue)),
        firstPaymentDue: current.payments[0]?.dueDate });
      // (เงื่อนไข `deletedAt: null` ต้องเหมือนด่านนอก tx เป๊ะ — ไม่งั้นการลบที่แทรกเข้ามา
      // ระหว่างสองด่านจะหลุดผ่านด่านใน tx ซึ่งเป็นตาข่ายสุดท้ายก่อนเงิน/กรรมสิทธิ์ขยับ)
      const prod = await tx.product.findFirst({
        where: { id: contract.productId, deletedAt: null },
      });
      if (!prod || (prod.status !== 'RESERVED' && prod.status !== 'IN_STOCK')) {
        throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
      }
      // Step 8: สถานะเปลี่ยนเป็น ACTIVE → เริ่มนับงวด.
      // Phase A.4: unearnedInterest / unearnedCommission fields removed (A.2 deferred).
      await tx.contract.update({
        where: { id },
        data: {
          status: 'ACTIVE',
        },
      });
      await tx.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } });
      // ของแถมของสัญญา (จองไว้ตั้งแต่ตอนสร้าง) → ตัดสต๊อกพร้อมเครื่องหลัก. อ่านจากแถวใน tx (`current`)
      // ไม่ใช่ snapshot นอก tx — การแก้ของแถมที่ commit คั่นกลางต้องถูกเห็น. สัญญาจากเปลี่ยนเครื่อง = [] เสมอ
      const contractBundleIds = normalizeBundleIds(current.bundleProductIds);
      await sellContractBundles(tx, contractBundleIds);
      // เครื่องยึดที่ถูกนำกลับเข้าคลังแล้วขายผ่อนใหม่ → ปิดรายการยึดเป็น SOLD พร้อมราคาขายจริง
      // (คู่ของ POS ใน SaleWriterService; ยกเลิกสัญญา C-1 เปิดกลับ — 2026-09-05). เครื่องปกติ = 0 แถว
      await closeRepossessionOnSale(tx, {
        productId: contract.productId,
        resellPrice: contract.sellingPrice,
        soldContractId: id,
      });

      // Ownership transfer: SHOP → FINANCE.
      // Per CLAUDE.md business rule: "กรรมสิทธิ์สินค้าย้ายจาก SHOP → FINANCE
      // (จนลูกค้าผ่อนครบ)". Runs inside the activation transaction so
      // ownership can never drift from contract status. Reuses financeCompany
      // resolved before the tx (F-3-027 part 2/3) — missing FINANCE entity
      // is now a hard error rather than a silent warn-and-continue.
      await this.productsService.transferOwnership(
        contract.productId,
        financeCompany.id,
        tx,
      );

      if (isExchangeContract) {
        // SP2 finalize: the exchange-specific JE chain (A.1 + A.2 + A.3 + A.4)
        // posts here + old contract flips to EXCHANGED + old product flips to
        // REFURBISHED+SHOP. Skip the normal ContractActivation1A JE (replaced
        // by A.1 inside finalizeAfterActivation) and the Sale row (an exchange
        // is not a fresh retail sale — no down payment, no new revenue
        // recognition; FINANCE side just rolls outstanding from old → new).
        await this.contractExchangeService.finalizeAfterActivation(
          {
            id: contract.id,
            productId: contract.productId,
            exchangedFromContractId: (contract as any).exchangedFromContractId,
            financedAmount: contract.financedAmount,
            storeCommission: contract.storeCommission,
            // F2 (SHOP-leg wiring) — same pre-tx `contract`/`contract.product`
            // snapshot the normal (non-exchange) branch below already trusts
            // for its own ShopInventoryTransferTemplate call.
            contractNumber: contract.contractNumber,
            downPayment: contract.downPayment,
            productCategory: contract.product.category,
            productCostPrice: contract.product.costPrice,
          },
          tx,
        );
      } else {
        // Standard activation flow — auto-create Sale record + post 1A JE.
        const existingSale = await tx.sale.findFirst({ where: { contractId: contract.id, deletedAt: null } });
        let contractSaleId = existingSale?.id;
        if (!existingSale) {
        const saleNumber = await generateSaleNumber(tx);
        const createdSale = await tx.sale.create({
          data: {
            saleNumber,
            saleType: 'INSTALLMENT',
            costSnapshot: { create: { mainProductCost: prod.costPrice } },
            tradeInCreditSnapshot: contract.tradeInCreditSnapshot ?? undefined,
            customerId: contract.customerId,
            productId: contract.productId,
            branchId: contract.branchId,
            salespersonId: contract.salespersonId,
            sellingPrice: contract.sellingPrice,
            discount: 0,
            netAmount: contract.sellingPrice,
            paymentMethod: contract.downPaymentMethod ?? null,
            amountReceived: cashDownPayment(contract),
            downPaymentAmount: contract.downPayment,
            contractId: contract.id,
            // ของแถมผูกกับใบขาย — ขาต้นทุนด้านล่าง (saleForBundles → bundleCosts) อ่านจากตรงนี้
            bundleProductIds: contractBundleIds,
            notes: `สร้างอัตโนมัติจากสัญญา ${contract.contractNumber}`,
          },
        });
        contractSaleId = createdSale.id;
        }

        if (existingSale) {
          const net = new Decimal(contract.sellingPrice.toString());
          const gross = new Decimal(existingSale.sellingPrice.toString());
          await tx.sale.update({ where: { id: existingSale.id }, data: {
            costSnapshot: { upsert: { create: { mainProductCost: prod.costPrice }, update: {} } },
            netAmount: net, sellingPrice: gross.gte(net) ? gross : net, discount: gross.gte(net) ? gross.minus(net) : new Decimal(0),
            downPaymentAmount: contract.downPayment, amountReceived: cashDownPayment(contract),
            ...(contract.downPaymentMethod ? { paymentMethod: contract.downPaymentMethod } : {}),
            tradeInCreditSnapshot: contract.tradeInCreditSnapshot ?? undefined,
            // ใบขายจากเส้นทางเก่า (POST /sales) ถือของแถมของตัวเองอยู่แล้ว — รวมของแถมฝั่งสัญญาเข้าไปไม่ให้ตกหล่น
            ...(contractBundleIds.length
              ? { bundleProductIds: Array.from(new Set([...(existingSale.bundleProductIds ?? []), ...contractBundleIds])) }
              : {}),
          } });
        }

        // ค่าคอมพนักงานขาย — เจ้าของเคาะ 2026-09-20: เหมือนขายสด ตั้งตอนเปิดใช้สัญญา
        // (สัญญาจากเส้นทางเก่ามีค่าคอมตั้งแต่ตอนร่างแล้ว ⇒ helper ไม่สร้างซ้ำ)
        if (contractSaleId) {
          await ensureContractCommission(tx, { contractId: contract.id, saleId: contractSaleId,
            salespersonId: contract.salespersonId, netAmount: new Decimal(contract.sellingPrice.toString()) });
        }

        // Auto journal entry — record contract activation (HP receivable).
        // Wave 1 / Task 4: 1A JE now runs inside the outer $transaction by
        // passing `tx` to the template. If the JE fails (unbalanced, FK, etc.)
        // the entire activation rolls back — contract stays DRAFT, product
        // ownership is not transferred, sale row is not created. This closes
        // audit Wave 1 P0 W-1 (ปพพ.386 termination atomicity) which the prior
        // fire-and-forget pattern violated by leaving contracts ACTIVE without
        // any ledger entry when the JE failed.
        // ── ค่าคอมสำรอง: resolve จาก config ครั้งเดียว แล้ว "ตรึง" ลงสัญญา ──────
        // (คำวินิจฉัยผู้สอบ C2 รอบ 2, 2026-08-25 — "ตั้งอัตราสำรองได้ แก้ไขได้")
        //
        // ต้องทำ **ก่อน** 1A เพราะ 1A อ่าน `contract.storeCommission` เอง ส่วนขา SHOP
        // ด้านล่างรับค่าจาก caller ⇒ ถ้าปล่อยให้ต่างฝ่ายต่าง fallback แล้วอัตราถูกแก้
        // คั่นกลาง สองสมุดจะได้ค่าคอมคนละตัว = COMMISSION_ONLY_GAP กลับมา
        //
        // เขียนกลับลงสัญญาเพื่อให้ replay ได้ผลเดิมเสมอ แม้อัตราใน config จะเปลี่ยนภายหลัง
        if (contract.storeCommission == null) {
          const { storeCommissionPct } = await loadInstallmentConfig(this.prisma);
          const resolved = resolveStoreCommission({
            storeCommission: null,
            financedAmount: new Decimal(contract.financedAmount.toString()),
            fallbackRate: storeCommissionPct,
          });
          await tx.contract.update({
            where: { id: contract.id },
            data: { storeCommission: resolved },
          });
          // ให้ object ในหน่วยความจำตรงกับ DB — ขา SHOP ด้านล่างอ่านจากตัวนี้
          contract.storeCommission = resolved;
        }

        await this.contractActivation1ATemplate.execute(contract.id, tx);

        // SHOP-side: post inventory transfer (COGS + revenue + receivables + down clearance),
        // atomic with the FINANCE 1A entry. salePrice is reconstructed as down+financed (D-8)
        // so the template's financing-identity assertion holds by construction.
        const downAmount = new Decimal(contract.downPayment.toString());
        const cashDown = cashDownPayment(contract);
        const financedAmt = new Decimal(contract.financedAmount.toString());

        // In-flight rollout guard (spec §12): a contract created BEFORE this feature
        // shipped never got a ShopDownPayment JE, but ShopInventoryTransfer below will
        // Dr S21-2001 to "clear" the down payable. If no down JE exists yet, post a
        // catch-up ShopDownPayment first so the clearance lands against a real credit.
        if (cashDown.gt(0)) {
          const downJe = await tx.journalEntry.findFirst({
            where: {
              AND: [
                { metadata: { path: ['flow'], equals: 'shop-down-payment' } as any },
                { metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${contract.id}` } as any },
              ],
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!downJe) {
            if (!contract.downPaymentMethod || !contract.downPaymentReceivedAt) {
              throw new BadRequestException('ไม่พบหลักฐานรับเงินดาวน์ของสัญญาเดิม กรุณาตรวจสอบการรับเงินก่อนเปิดใช้งาน');
            }
            const cashAccountCode = await this.shopAccountResolver.resolveInflowCashAccount(contract.branchId, contract.downPaymentMethod, tx);
            await this.shopDownPaymentTemplate.execute(
              {
                idempotencyKey: `shop-down-payment:${contract.id}`,
                contractId: contract.id,
                contractNumber: contract.contractNumber,
                cashAccountCode,
                downAmount: cashDown,
              },
              tx,
            );
          }
        }

        const acc = this.shopAccountResolver.resolveProductAccounts(contract.product.category);

        // ของแถมต้องตัดสต็อกทุกครั้ง (คำสั่งเจ้าของ 2026-08-26)
        // ของแถมผูกกับ **ใบขาย** ไม่ใช่สัญญา — Sale.bundleProductIds เก็บถาวร
        // และ Sale.contractId ชี้กลับมาที่สัญญานี้ ⇒ หาได้ตอน activate
        // เดิมตกหล่น: markBundleProductsSold พลิกสถานะเป็น SOLD_CASH ตอนสร้างใบขาย
        // แต่ไม่มีใครตัดต้นทุนออกจากสต็อก ⇒ สินค้าคงเหลือสูงเกินจริงถาวร
        const saleForBundles = await tx.sale.findFirst({
          where: { contractId: contract.id, deletedAt: null },
          select: { bundleProductIds: true },
        });
        const bundleProducts = saleForBundles?.bundleProductIds?.length
          ? await tx.product.findMany({
              where: { id: { in: saleForBundles.bundleProductIds } },
              select: { id: true, category: true, costPrice: true },
            })
          : [];

        await this.shopInventoryTransferTemplate.execute(
          {
            idempotencyKey: `shop-inventory-transfer:${contract.id}`,
            bundleCosts: bundleProducts.map((bp) => {
              const bAcc = this.shopAccountResolver.resolveProductAccounts(bp.category);
              return {
                productId: bp.id,
                cogsAccountCode: bAcc.cogsAccountCode,
                inventoryAccountCode: bAcc.inventoryAccountCode,
                cost: new Decimal((bp.costPrice ?? 0).toString()),
              };
            }),
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            productId: contract.productId,
            inventoryAccountCode: acc.inventoryAccountCode,
            cogsAccountCode: acc.cogsAccountCode,
            revenueAccountCode: acc.revenueAccountCode,
            costPrice: new Decimal(contract.product.costPrice.toString()),
            salePrice: downAmount.plus(financedAmt),
            downAmount,
            financedAmount: financedAmt,
            // CPA ruling C1 (2026-08-24): SHOP ต้องตั้งค่าคอมให้ตรง FINANCE เพราะเป็น
            // รายได้หน้าร้าน S41-1201 — เดิมตรงนี้ตั้ง 0 ขณะที่ 1A ตั้ง fallback 10%
            // ⇒ ค่าคอมโผล่สมุดเดียว (COMMISSION_ONLY_GAP). helper เดียวกับ 1A
            commission: resolveStoreCommission({
              storeCommission: contract.storeCommission,
              financedAmount: financedAmt,
            }),
          },
          tx,
        );
      }

      // Phase A.4 — generate installment_schedules rows so accrual cron + payment
      // preview API can find them. Per-installment due_date = startDate + (i × 1 month).
      // Runs inside the activation $transaction (same `tx`) and is awaited: if it
      // fails, the whole activation rolls back — contract stays DRAFT with no JE
      // and no schedule — rather than committing an ACTIVE contract with no
      // installment rows (which silently breaks the accrual cron + payment preview).
      // (Was fire-and-forget on this.prisma: not awaited, off-transaction, and a
      // failure left a broken ACTIVE contract behind a fire-and-forget log line.)
      await this.generateInstallmentSchedules(contract, tx);
    });

    // Send LINE notification to customer (non-blocking)
    this.sendContractActivatedNotification(contract).catch(err =>
      this.logger.warn(`Failed to send contract activation notification: ${err?.message || err}`),
    );

    return this.findOne(id);
  }

  /**
   * Phase A.4 — generate installment_schedules rows on contract activation.
   * Idempotent: skips if rows already exist for this contract.
   * Per-installment values:
   *   principal = financedAmount / totalMonths (ROUND_DOWN truncate)
   *   interest  = interestTotal / totalMonths (ROUND_HALF_UP)
   *   amountDue = monthlyPayment (incl. VAT)
   *   dueDate   = startDate + (i months)
   */
  private async generateInstallmentSchedules(
    contract: { id: string; contractNumber: string },
    tx: Prisma.TransactionClient,
  ) {
    const c = await tx.contract.findUniqueOrThrow({
      where: { id: contract.id },
    });
    const existing = await tx.installmentSchedule.count({
      where: { contractId: c.id, deletedAt: null },
    });
    if (existing > 0) {
      this.logger.log(`Skipping schedule generation for contract ${c.contractNumber} — ${existing} rows already exist`);
      return;
    }
    const total = c.totalMonths;
    if (total <= 0) {
      this.logger.warn(`Cannot generate schedule for contract ${c.contractNumber} — totalMonths=${total}`);
      return;
    }

    // Algorithm consolidated into installment-schedule.util — single source of
    // truth shared with the backfill CLI and the payment-receipt lazy-gen path.
    const rows = buildInstallmentScheduleRows(c);
    await tx.installmentSchedule.createMany({ data: rows });
    this.logger.log(`Generated ${rows.length} installment_schedules rows for contract ${c.contractNumber}`);
  }

  private async sendContractActivatedNotification(contract: Awaited<ReturnType<ContractWorkflowService['findOne']>>) {
    if (!this.notificationsService) {
      this.logger.warn(
        `NotificationsService unavailable - cannot send activation notification for contract ${contract.contractNumber || contract.id}`,
      );
      return;
    }
    const customer = contract.customer;
    if (!customer) return;

    const firstPayment = await this.prisma.payment.findFirst({
      where: { contractId: contract.id, installmentNo: 1, deletedAt: null },
      select: { dueDate: true },
    });
    const firstDueDate = firstPayment
      ? formatDateShort(firstPayment.dueDate)
      : 'ตามสัญญา';

    const message = [
      `สัญญาผ่อนชำระ ${contract.contractNumber} อนุมัติแล้ว`,
      `สินค้า: ${contract.product?.brand || ''} ${contract.product?.model || ''}`,
      `ค่างวด: ${Number(contract.monthlyPayment).toLocaleString()} ฿/เดือน`,
      `งวดแรก: ${firstDueDate}`,
      `ขอบคุณที่ไว้วางใจ BESTCHOICE`,
    ].join('\n');

    const lineId = customer.lineIdFinance;
    if (lineId) {
      await this.notificationsService.send({
        channel: 'LINE',
        channelKey: 'line-finance',
        recipient: lineId,
        message,
        relatedId: contract.id,
        fallbackPhone: customer.phone || undefined,
        customerId: customer.id,
        category: NotificationCategory.TRANSACTIONAL,
      });
    } else if (customer.phone) {
      await this.notificationsService.send({
        channel: 'SMS',
        recipient: customer.phone,
        message,
        relatedId: contract.id,
        customerId: customer.id,
        category: NotificationCategory.TRANSACTIONAL,
      });
    }
  }

  /** Shared findOne - reuses Prisma query for contract with full includes */
  private async findOne(id: string, actor?: CreditHistoryActor) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        product: { include: { prices: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        interestConfig: true,
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        signatures: { where: { deletedAt: null } },
        eDocuments: { where: { deletedAt: null } },
        contractDocuments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
        creditCheck: {
          include: {
            checkedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    return visibleContractCredit(this.prisma, contract, actor);
  }
}
