import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
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
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import * as crypto from 'crypto';

@Injectable()
export class ContractWorkflowService {
  private readonly logger = new Logger(ContractWorkflowService.name);
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private journalAutoService: JournalAutoService,
    private productsService: ProductsService,
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
  async submitForReview(id: string, userId: string) {
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

    // Step 1: Credit check must be approved
    if (!contract.creditCheck || contract.creditCheck.status !== 'APPROVED') {
      if (isDev) {
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

    return this.findOne(id);
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

    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'APPROVED',
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

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

    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'REJECTED',
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    return this.findOne(id);
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

    // Require all required signatures (customer + company + 2 witnesses)
    const customerSigned = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'CUSTOMER');
    const companySigned = contract.signatures?.some((s: { signerType: string }) =>
      s.signerType === 'COMPANY' || s.signerType === 'STAFF'
    );
    const witness1Signed = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'WITNESS_1');
    const witness2Signed = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'WITNESS_2');

    if (!customerSigned || !companySigned) {
      throw new BadRequestException('ต้องลงนามครบทั้งผู้ซื้อและผู้ขายก่อนเปิดใช้งานสัญญา');
    }
    if (!witness1Signed || !witness2Signed) {
      throw new BadRequestException('ต้องมีพยานลงนามครบ 2 คนก่อนเปิดใช้งานสัญญา');
    }

    // Check guardian signature if required
    if (contract.customer?.birthDate) {
      const ageCheck = checkAgeEligibility(new Date(contract.customer.birthDate));
      if (ageCheck.requiresGuardian) {
        const guardianSigned = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'GUARDIAN');
        if (!guardianSigned) {
          throw new BadRequestException('ลูกค้าอายุต่ำกว่า 20 ปี ต้องมีผู้ปกครองลงนาม');
        }
      }
    }

    // Verify product is still reserved for this contract
    const product = await this.prisma.product.findUnique({ where: { id: contract.productId } });
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

    await this.prisma.$transaction(async (tx) => {
      // Re-check product status inside transaction to prevent race condition
      const prod = await tx.product.findUnique({ where: { id: contract.productId } });
      if (!prod || (prod.status !== 'RESERVED' && prod.status !== 'IN_STOCK')) {
        throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
      }
      // Step 8: สถานะเปลี่ยนเป็น ACTIVE → เริ่มนับงวด.
      // Phase A.2: also seed unearnedInterest + unearnedCommission so payment
      // JEs can drain them (deferred recognition cash-basis per TFRS NPAEs).
      await tx.contract.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          unearnedInterest: contract.interestTotal,
          unearnedCommission: contract.storeCommission ?? 0,
        },
      });
      await tx.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } });

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

      // Auto-create Sale record for this contract activation
      const saleNumber = await generateSaleNumber(tx);
      await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'INSTALLMENT',
          customerId: contract.customerId,
          productId: contract.productId,
          branchId: contract.branchId,
          salespersonId: contract.salespersonId,
          sellingPrice: contract.sellingPrice,
          discount: 0,
          netAmount: contract.sellingPrice,
          paymentMethod: 'CASH',
          amountReceived: contract.downPayment,
          downPaymentAmount: contract.downPayment,
          contractId: contract.id,
          bundleProductIds: [],
          notes: `สร้างอัตโนมัติจากสัญญา ${contract.contractNumber}`,
        },
      });

      // Auto journal entry — record contract activation (sales + COGS).
      // Atomic with contract activation: if JE fails, the entire $transaction
      // rolls back. The pre-v4 try/catch silently swallowed JE failures,
      // leaving the contract ACTIVE without any ledger entry — defeating
      // the v4 unbalanced-throw guard (audit findings F-1-002 / F-2-003).
      // NestJS' global exception filter logs the propagated error.
      await this.journalAutoService.createContractActivationJournal(tx, {
        shopCompanyId: shopCompany.id,
        financeCompanyId: financeCompany.id,
        contract: {
          id: contract.id,
          contractNumber: contract.contractNumber,
          sellingPrice: contract.sellingPrice,
          downPayment: contract.downPayment,
          financedAmount: contract.financedAmount,
          interestTotal: contract.interestTotal,
          storeCommission: contract.storeCommission ?? 0,
          vatAmount: contract.vatAmount ?? 0,
        },
        product: { costPrice: prod.costPrice, category: prod.category },
        userId: contract.salespersonId,
      });
    });

    // Send LINE notification to customer (non-blocking)
    this.sendContractActivatedNotification(contract).catch(err =>
      this.logger.warn(`Failed to send contract activation notification: ${err?.message || err}`),
    );

    return this.findOne(id);
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
  private async findOne(id: string) {
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
        eDocuments: true,
        contractDocuments: {
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
    return contract;
  }
}
