import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class CustomerAccessService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a secure token-based link for customer to access their documents
   * Token expires in 48 hours (configurable via system config)
   */
  async generateAccessToken(contractId: string): Promise<{ token: string; expiresAt: Date }> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Get expiry hours from config
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'customer_access_token_hours' },
    });
    const expiryHours = parseInt(config?.value || '48');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiryHours);

    await this.prisma.customerAccessToken.create({
      data: { token, contractId, expiresAt },
    });

    return { token, expiresAt };
  }

  /**
   * Validate token and return accessible documents
   * ลูกค้ากดลิงก์ → ดู/ดาวน์โหลดสัญญา + ตารางผ่อน + ใบเสร็จ
   */
  async accessDocuments(token: string) {
    const accessToken = await this.prisma.customerAccessToken.findUnique({
      where: { token },
    });
    if (!accessToken) throw new NotFoundException('ลิงก์ไม่ถูกต้อง');
    if (new Date() > accessToken.expiresAt) {
      throw new BadRequestException('ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่จากพนักงาน');
    }

    // Update access count
    await this.prisma.customerAccessToken.update({
      where: { id: accessToken.id },
      data: {
        accessedAt: accessToken.accessedAt || new Date(),
        accessCount: accessToken.accessCount + 1,
      },
    });

    // Get contract with documents
    const contract = await this.prisma.contract.findUnique({
      where: { id: accessToken.contractId },
      include: {
        customer: { select: { name: true } },
        product: { select: { name: true, brand: true, model: true } },
        branch: { select: { name: true } },
        payments: {
          orderBy: { installmentNo: 'asc' },
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
            documentType: {
              in: ['SIGNED_CONTRACT', 'PAYMENT_SCHEDULE', 'PDPA_CONSENT'],
            },
            isLatest: true,
          },
          select: { id: true, documentType: true, fileName: true, createdAt: true },
        },
        receipts: {
          where: { isVoided: false },
          orderBy: { createdAt: 'desc' },
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

    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    return {
      contractNumber: contract.contractNumber,
      customerName: contract.customer?.name,
      productName: `${contract.product?.brand} ${contract.product?.model}`,
      branchName: contract.branch?.name,
      status: contract.status,
      totalMonths: contract.totalMonths,
      monthlyPayment: contract.monthlyPayment,
      payments: contract.payments,
      documents: contract.contractDocuments,
      receipts: contract.receipts,
    };
  }
}
