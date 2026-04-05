import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateShort } from '../../utils/thai-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  checkAgeEligibility,
  checkRequiredContractFields,
  checkRequiredDocuments,
  checkRequiredSignatures,
} from '../../utils/validation.util';
import { generateSaleNumber } from '../../utils/sequence.util';
import * as crypto from 'crypto';

@Injectable()
export class ContractWorkflowService {
  private readonly logger = new Logger(ContractWorkflowService.name);
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

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

    // Generate contract hash for integrity
    const contractData = JSON.stringify({
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      productId: contract.productId,
      sellingPrice: contract.sellingPrice,
      downPayment: contract.downPayment,
      totalMonths: contract.totalMonths,
      monthlyPayment: contract.monthlyPayment,
    });
    const contractHash = crypto.createHash('sha256').update(contractData).digest('hex');

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

    // Verify contract hash integrity — detect if critical data was modified after submission
    if (contract.contractHash) {
      const currentData = JSON.stringify({
        contractNumber: contract.contractNumber,
        customerId: contract.customerId,
        productId: contract.productId,
        sellingPrice: contract.sellingPrice,
        downPayment: contract.downPayment,
        totalMonths: contract.totalMonths,
        monthlyPayment: contract.monthlyPayment,
      });
      const currentHash = crypto.createHash('sha256').update(currentData).digest('hex');
      if (currentHash !== contract.contractHash) {
        throw new BadRequestException(
          'ข้อมูลสัญญาถูกแก้ไขหลังส่งตรวจสอบ — contractHash ไม่ตรงกัน กรุณาส่งตรวจใหม่',
        );
      }
    }

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

    await this.prisma.$transaction(async (tx) => {
      // Re-check product status inside transaction to prevent race condition
      const prod = await tx.product.findUnique({ where: { id: contract.productId } });
      if (!prod || (prod.status !== 'RESERVED' && prod.status !== 'IN_STOCK')) {
        throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
      }
      // Step 8: สถานะเปลี่ยนเป็น ACTIVE → เริ่มนับงวด
      await tx.contract.update({ where: { id }, data: { status: 'ACTIVE' } });
      await tx.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } });

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
      where: { contractId: contract.id, installmentNo: 1 },
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

    const lineId = customer.lineId;
    if (lineId) {
      await this.notificationsService.send({
        channel: 'LINE',
        recipient: lineId,
        message,
        relatedId: contract.id,
        fallbackPhone: customer.phone || undefined,
      });
    } else if (customer.phone) {
      await this.notificationsService.send({
        channel: 'SMS',
        recipient: customer.phone,
        message,
        relatedId: contract.id,
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
        payments: { orderBy: { installmentNo: 'asc' } },
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
