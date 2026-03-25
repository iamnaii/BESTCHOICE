import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ContractDocumentService {
  private readonly logger = new Logger(ContractDocumentService.name);
  constructor(
    private prisma: PrismaService,
  ) {}

  // ─── QR Code Verification ────────────────────────────
  // Public endpoint — hash is REQUIRED to prevent contract ID enumeration
  async verifyContract(id: string, hash?: string) {
    // Require hash to prevent unauthenticated ID enumeration
    if (!hash) {
      return { verified: false, reason: 'ต้องระบุ hash สำหรับการยืนยันสัญญา' };
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id },
      select: {
        id: true,
        contractNumber: true,
        contractHash: true,
        status: true,
        createdAt: true,
        // Only include minimal data for public verification — no customer PII
        signatures: {
          select: { signerType: true, signedAt: true },
        },
      },
    });

    if (!contract || !contract.contractHash) {
      // Return generic message to prevent ID enumeration
      return { verified: false, reason: 'ไม่พบสัญญาหรือ hash ไม่ถูกต้อง' };
    }

    // Use timing-safe comparison to prevent timing attacks
    const isHashValid = contract.contractHash.length === hash.length &&
      crypto.timingSafeEqual(Buffer.from(contract.contractHash), Buffer.from(hash));

    if (!isHashValid) {
      return { verified: false, reason: 'ไม่พบสัญญาหรือ hash ไม่ถูกต้อง' };
    }

    // Only return minimal info when hash is valid — no PII
    return {
      verified: true,
      reason: 'สัญญาได้รับการยืนยันแล้ว',
      contract: {
        contractNumber: contract.contractNumber,
        status: contract.status,
        createdAt: contract.createdAt,
      },
      signatureCount: contract.signatures.length,
    };
  }

  // ─── Document Dashboard for Manager/Admin ──────────────
  async getDocumentDashboard(branchId?: string) {
    const where: Record<string, unknown> = {};
    if (branchId) where.branchId = branchId;

    // Get all active contracts with their documents and signatures
    const contracts = await this.prisma.contract.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        customer: { select: { name: true } },
        eDocuments: { select: { id: true, documentType: true } },
        signatures: { select: { id: true, signerType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const REQUIRED_DOCS = ['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO', 'DEVICE_IMEI_PHOTO', 'DOWN_PAYMENT_RECEIPT', 'PDPA_CONSENT'];
    const REQUIRED_SIGS = ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'];

    let fullyDocumented = 0;
    let pendingDocuments = 0;
    let pendingSignatures = 0;
    let pendingApproval = 0;
    let overdueContracts = 0;

    const branchMap = new Map<string, { branchId: string; branchName: string; total: number; documented: number; pendingDocs: number; pendingSigs: number }>();

    for (const c of contracts) {
      const docTypes = new Set(c.eDocuments.map((d) => d.documentType));
      const sigTypes = new Set(c.signatures.map((s) => s.signerType as string));
      const hasAllDocs = REQUIRED_DOCS.every((d) => docTypes.has(d));
      const hasAllSigs = REQUIRED_SIGS.every((s) => sigTypes.has(s));

      if (hasAllDocs && hasAllSigs) fullyDocumented++;
      if (!hasAllDocs) pendingDocuments++;
      if (!hasAllSigs) pendingSignatures++;
      if (c.workflowStatus === 'PENDING_REVIEW' || c.workflowStatus === 'CREATING') pendingApproval++;
      if (c.status === 'OVERDUE' || c.status === 'DEFAULT') overdueContracts++;

      // By branch
      const bId = c.branchId || 'unknown';
      const bName = c.branch?.name || 'ไม่ระบุ';
      if (!branchMap.has(bId)) {
        branchMap.set(bId, { branchId: bId, branchName: bName, total: 0, documented: 0, pendingDocs: 0, pendingSigs: 0 });
      }
      const b = branchMap.get(bId)!;
      b.total++;
      if (hasAllDocs && hasAllSigs) b.documented++;
      if (!hasAllDocs) b.pendingDocs++;
      if (!hasAllSigs) b.pendingSigs++;
    }

    // SLA alerts: contracts waiting for approval > 24h
    const slaAlerts = contracts
      .filter((c) => ['PENDING_REVIEW', 'CREATING'].includes(c.workflowStatus || ''))
      .map((c) => {
        const hoursWaiting = Math.round((Date.now() - new Date(c.updatedAt).getTime()) / (1000 * 60 * 60));
        return {
          id: c.id,
          contractNumber: c.contractNumber,
          customerName: c.customer?.name || '',
          workflowStatus: c.workflowStatus,
          hoursWaiting,
          branchName: c.branch?.name || '',
        };
      })
      .filter((a) => a.hoursWaiting >= 24)
      .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
      .slice(0, 20);

    // Recent document activity from audit log (batch fetch to avoid N+1)
    let recentActivity: Array<{ id: string; contractNumber: string; customerName: string; action: string; createdAt: string; branchName: string }> = [];
    try {
      const audits = await this.prisma.documentAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      // Batch-fetch all referenced contracts in one query
      const contractIds = [...new Set(audits.map((a) => a.contractId))];
      const auditContracts = contractIds.length > 0
        ? await this.prisma.contract.findMany({
            where: { id: { in: contractIds } },
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { name: true } },
              branch: { select: { name: true } },
            },
          })
        : [];
      const contractMap = new Map(auditContracts.map((c) => [c.id, c]));

      recentActivity = audits.map((a) => {
        const c = contractMap.get(a.contractId);
        return {
          id: a.id,
          contractNumber: c?.contractNumber || '',
          customerName: c?.customer?.name || '',
          action: a.action,
          createdAt: a.createdAt.toISOString(),
          branchName: c?.branch?.name || '',
        };
      });
    } catch {
      // DocumentAuditLog might not exist yet
    }

    return {
      totalContracts: contracts.length,
      fullyDocumented,
      pendingDocuments,
      pendingSignatures,
      pendingApproval,
      overdueContracts,
      byBranch: Array.from(branchMap.values()),
      recentActivity,
      slaAlerts,
    };
  }

  async getQrData(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      select: { id: true, contractNumber: true, contractHash: true },
    });

    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    // QR code content: verification URL with contract ID and hash
    const verifyUrl = `/api/contracts/${contract.id}/verify?hash=${contract.contractHash || ''}`;

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      contractHash: contract.contractHash,
      verifyUrl,
      qrContent: JSON.stringify({
        type: 'BESTCHOICE_CONTRACT',
        id: contract.id,
        number: contract.contractNumber,
        hash: contract.contractHash,
        verifyUrl,
      }),
    };
  }

  /** Record PDPA consent and link to contract */
  async recordPdpaConsent(
    contractId: string,
    signatureImage: string,
    req: { ip?: string; userAgent?: string },
  ) {
    // Validate signature image size (max 2MB base64 ≈ ~2.7MB string)
    const MAX_SIGNATURE_SIZE = 3 * 1024 * 1024; // 3MB string length
    if (!signatureImage) {
      throw new BadRequestException('ต้องมีลายเซ็น');
    }
    if (signatureImage.length > MAX_SIGNATURE_SIZE) {
      throw new BadRequestException('ลายเซ็นมีขนาดใหญ่เกินไป (สูงสุด 2MB)');
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    if (contract.pdpaConsentId) throw new BadRequestException('สัญญานี้มี PDPA consent แล้ว');

    // Get privacy notice version
    const versionConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'pdpa_privacy_notice_version' },
    });

    const consent = await this.prisma.pDPAConsent.create({
      data: {
        customerId: contract.customerId,
        consentVersion: versionConfig?.value || '1.0',
        privacyNoticeText: 'ยินยอมตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
        purposes: [
          'สัญญาผ่อนชำระสินค้า',
          'ติดตามหนี้และบริหารสัญญา',
          'จัดทำเอกสารทางกฎหมาย',
          'ติดต่อสื่อสารเกี่ยวกับสัญญา',
        ],
        status: 'GRANTED',
        grantedAt: new Date(),
        ipAddress: req.ip || null,
        deviceInfo: req.userAgent || null,
        signatureImage: signatureImage || null,
      },
    });

    // Link consent to contract
    await this.prisma.contract.update({
      where: { id: contractId },
      data: { pdpaConsentId: consent.id },
    });

    return consent;
  }

  /** Get PDPA consent for contract */
  async getPdpaConsent(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { pdpaConsentId: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (!contract.pdpaConsentId) return null;

    return this.prisma.pDPAConsent.findUnique({
      where: { id: contract.pdpaConsentId },
    });
  }
}
