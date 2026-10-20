import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessContractConsentAuthority } from '../employee-access/access-contract-consent-authority';
import * as crypto from 'crypto';

@Injectable()
export class CustomerAccessService {
  constructor(
    private prisma: PrismaService,
    private readonly authority: AccessContractConsentAuthority,
  ) {}
  async generateAccessToken(
    contractId: string,
    actorId?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    return this.authority.run(
      contractId,
      'generateAccessToken',
      actorId,
      async (tx, contract, actor) => {
        await tx.$queryRaw`SELECT key FROM system_config WHERE key='customer_access_token_hours' FOR SHARE`;
        const config = await tx.systemConfig.findUnique({
          where: { key: 'customer_access_token_hours' },
        });
        const configured = Number(config?.value);
        const hours = Number.isFinite(configured) && configured > 0 ? configured : 48;
        const candidate = Date.now() + hours * 3600000;
        const expiresAt = new Date(
          Number.isFinite(candidate) && candidate <= 8640000000000000
            ? candidate
            : Date.now() + 48 * 3600000,
        );
        const token = crypto.randomBytes(32).toString('hex');
        const row = await tx.customerAccessToken.create({
          data: {
            token,
            contractId,
            expiresAt,
            issuedById: actor,
            recipientCustomerId: contract.customerId,
            accessCompanyCode: 'FINANCE',
            sourceBranchId: contract.branchId,
            projectionVersion: 1,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: actor,
            action: 'CUSTOMER_ACCESS_ISSUED',
            entity: 'contract',
            entityId: contractId,
            newValue: {
              tokenRowId: row.id,
              contractId,
              recipientCustomerId: contract.customerId,
              issuerId: actor,
              sourceCompany: 'FINANCE',
              sourceBranchId: contract.branchId,
              projectionVersion: 1,
              expiresAt: expiresAt.toISOString(),
            },
          },
        });
        return { token, expiresAt };
      },
    );
  }
  /** Customer authentication is independent of the issuer's later staff grants. */
  async accessDocuments(token: string) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token))
      throw new NotFoundException('ลิงก์ไม่ถูกต้อง');
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        // Serialize reads of this bearer and preserve its actual 50-use ceiling.
        await tx.$queryRaw`SELECT id FROM customer_access_tokens WHERE token=${token} FOR UPDATE`;
        const access = await tx.customerAccessToken.findUnique({ where: { token } });
        if (!access) throw new NotFoundException('ลิงก์ไม่ถูกต้อง');
        if (access.expiresAt <= now || access.accessCount >= 50)
          throw new BadRequestException('ลิงก์หมดอายุหรือใช้งานครบแล้ว กรุณาขอลิงก์ใหม่');
        const legacy =
          access.issuedById === null &&
          access.recipientCustomerId === null &&
          access.accessCompanyCode === null &&
          access.sourceBranchId === null &&
          access.projectionVersion === null;
        if (
          !legacy &&
          (!access.issuedById ||
            !access.recipientCustomerId ||
            access.accessCompanyCode !== 'FINANCE' ||
            !access.sourceBranchId ||
            access.projectionVersion !== 1)
        )
          throw new NotFoundException('ลิงก์ไม่ถูกต้อง');
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${access.contractId} FOR SHARE`;
        const contract = await tx.contract.findFirst({
          where: {
            id: access.contractId,
            deletedAt: null,
            ...(!legacy ? { customerId: access.recipientCustomerId! } : {}),
            customer: { deletedAt: null, mergedIntoId: null },
          },
          select: {
            contractNumber: true,
            status: true,
            totalMonths: true,
            monthlyPayment: true,
            customer: { select: { name: true } },
            product: { select: { brand: true, model: true } },
            branch: { select: { name: true } },
            payments: {
              where: { deletedAt: null },
              orderBy: [{ installmentNo: 'asc' }, { id: 'asc' }],
              select: {
                installmentNo: true,
                dueDate: true,
                amountDue: true,
                amountPaid: true,
                status: true,
                paidDate: true,
              },
            },
            contractDocuments: {
              where: {
                deletedAt: null,
                isLatest: true,
                documentType: { in: ['SIGNED_CONTRACT', 'PAYMENT_SCHEDULE', 'PDPA_CONSENT'] },
              },
              select: { id: true, documentType: true, fileName: true, createdAt: true },
            },
            receipts: {
              where: { deletedAt: null, isVoided: false },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: {
                id: true,
                receiptNumber: true,
                amount: true,
                installmentNo: true,
                paidDate: true,
                receiptType: true,
              },
            },
          },
        });
        if (!contract) throw new NotFoundException('ลิงก์ไม่ถูกต้อง');
        // Lock the exact current recipient too; a concurrent removal cannot race the check.
        const parent = await tx.contract.findUniqueOrThrow({
          where: { id: access.contractId },
          select: { customerId: true },
        });
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${parent.customerId} FOR SHARE`;
        if (
          !(await tx.customer.count({
            where: { id: parent.customerId, deletedAt: null, mergedIntoId: null },
          }))
        )
          throw new NotFoundException('ลิงก์ไม่ถูกต้อง');
        const used = await tx.customerAccessToken.updateMany({
          where: { id: access.id, accessCount: { lt: 50 }, expiresAt: { gt: new Date() } },
          data: { accessCount: { increment: 1 }, accessedAt: access.accessedAt ?? now },
        });
        if (used.count !== 1)
          throw new BadRequestException('ลิงก์หมดอายุหรือใช้งานครบแล้ว กรุณาขอลิงก์ใหม่');
        return {
          contractNumber: contract.contractNumber,
          customerName: contract.customer.name,
          productName: `${contract.product.brand} ${contract.product.model}`,
          branchName: contract.branch.name,
          status: contract.status,
          totalMonths: contract.totalMonths,
          monthlyPayment: contract.monthlyPayment,
          payments: contract.payments,
          documents: contract.contractDocuments,
          receipts: contract.receipts,
        };
      },
      { timeout: 30000 },
    );
  }
}
