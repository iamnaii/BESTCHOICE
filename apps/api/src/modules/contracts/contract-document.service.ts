import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessContractConsentAuthority } from '../employee-access/access-contract-consent-authority';
import { assertPresentedNotice, currentContractNotice, isValidContractConsent, linkedContractConsent, PresentedConsentNotice } from '../pdpa/contract-consent-evidence';
import * as crypto from 'crypto';

@Injectable()
export class ContractDocumentService {
  private readonly logger = new Logger(ContractDocumentService.name);
  constructor(
    private prisma: PrismaService,
    private readonly consentAuthority: AccessContractConsentAuthority,
  ) {}

  // ─── QR Code Verification ────────────────────────────
  // Public endpoint — hash is REQUIRED to prevent contract ID enumeration
  async verifyContract(id: string, hash?: string) {
    // Require hash to prevent unauthenticated ID enumeration
    if (typeof hash !== 'string' || !hash) {
      return { verified: false, reason: 'ต้องระบุ hash สำหรับการยืนยันสัญญา' };
    }

    if (typeof hash !== 'string') {
      return { verified: false, reason: 'ไม่พบสัญญาหรือ hash ไม่ถูกต้อง' };
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        contractHash: true,
        status: true,
        createdAt: true,
        // Only include minimal data for public verification — no customer PII
        signatures: {
          where: { deletedAt: null },
          select: { signerType: true, signedAt: true },
        },
      },
    });

    if (!contract || !contract.contractHash) {
      // Return generic message to prevent ID enumeration
      return { verified: false, reason: 'ไม่พบสัญญาหรือ hash ไม่ถูกต้อง' };
    }

    // Use timing-safe comparison to prevent timing attacks
    const expected = Buffer.from(contract.contractHash);
    const presented = Buffer.from(hash);
    const isHashValid =
      expected.length === presented.length && crypto.timingSafeEqual(expected, presented);

    if (!isHashValid) {
      return { verified: false, reason: 'ไม่พบสัญญาหรือ hash ไม่ถูกต้อง' };
    }

    // Only return minimal info when hash is valid — no PII
    return {
      verified: true,
      reason: 'สัญญาได้รับการยืนยันแล้ว',
      contract: {
        contractNumber: contract.contractNumber,
        status: null,
        createdAt: contract.createdAt,
      },
      signatureCount: contract.signatures.length,
    };
  }

  // ─── Document Dashboard for Manager/Admin ──────────────
  async getDocumentDashboard(branchId?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
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

    const REQUIRED_DOCS = ['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO', 'DEVICE_IMEI_PHOTO'];
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
            where: { id: { in: contractIds }, deletedAt: null },
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
    } catch (err) {
      this.logger.warn('DocumentAuditLog query failed (table may not exist yet)', err instanceof Error ? err.message : err);
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

  async getQrData(id: string, actorId?: string) {
    return this.consentAuthority.run(id, 'getQrData', actorId, async (_tx, contract) => {
      if (!contract.contractHash) throw new BadRequestException('สัญญายังไม่มีหลักฐานสำหรับยืนยัน');
      const verifyUrl = `/api/contracts/${contract.id}/verify?hash=${contract.contractHash}`;
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
    });
  }

  /** Staff captures genuine customer assent; the staff actor is not the signer. */
  async recordPdpaConsent(
    contractId: string,
    signatureImage: string,
    req: { ip?: string; userAgent?: string },
    actorId?: string,
    presented: PresentedConsentNotice = {},
  ) {
    return this.consentAuthority.run(
      contractId,
      'recordPdpaConsent',
      actorId,
      async (tx, contract, actor) => {
        if (
          typeof signatureImage !== 'string' ||
          !signatureImage ||
          signatureImage.length > 3 * 1024 * 1024
        )
          throw new BadRequestException('ต้องมีลายเซ็นขนาดไม่เกิน 3MB');
        if (contract.status !== 'DRAFT')
          throw new ConflictException('บันทึกความยินยอมได้เฉพาะก่อนเปิดสัญญา');
        await tx.$queryRaw`SELECT id FROM customers WHERE id=${contract.customerId} FOR SHARE`;
        if (
          !(await tx.customer.count({
            where: { id: contract.customerId, deletedAt: null, mergedIntoId: null },
          }))
        )
          throw new BadRequestException('ไม่พบลูกค้าของสัญญา');
        const notice = await currentContractNotice(tx);
        assertPresentedNotice(presented, notice);
        const old = await linkedContractConsent(tx, contract.pdpaConsentId);
        if (isValidContractConsent(old, contract.customerId))
          throw new ConflictException('สัญญามีความยินยอมที่ถูกต้องแล้ว');
        const consent = await tx.pDPAConsent.create({
          data: {
            customerId: contract.customerId,
            consentVersion: notice.version,
            privacyNoticeText: notice.text,
            purposes: notice.purposes,
            noticeDigest: notice.digest,
            capturedById: actor,
            status: 'GRANTED',
            grantedAt: new Date(),
            signatureImage,
            ipAddress: req.ip || null,
            deviceInfo: req.userAgent || null,
          },
        });
        const linked = await tx.contract.updateMany({
          where: {
            id: contract.id,
            deletedAt: null,
            status: 'DRAFT',
            customerId: contract.customerId,
            pdpaConsentId: contract.pdpaConsentId,
          },
          data: { pdpaConsentId: consent.id },
        });
        if (linked.count !== 1) throw new ConflictException('หลักฐานเปลี่ยนแปลง กรุณาโหลดใหม่');
        await tx.auditLog.create({
          data: {
            userId: actor,
            action: 'CONTRACT_PDPA_CAPTURE',
            entity: 'contract',
            entityId: contract.id,
            newValue: {
              contractId: contract.id,
              oldConsentId: contract.pdpaConsentId,
              newConsentId: consent.id,
              recipientCustomerId: contract.customerId,
              capturingActorId: actor,
              noticeVersion: notice.version,
              noticeDigest: notice.digest,
              outcome: 'SUCCESS',
            },
          },
        });
        return { id: contract.id, pdpaConsentId: consent.id };
      },
    );
  }

  /** Finite evidence checklist; no signature, IP/device, or historical notice bytes. */
  async getPdpaConsent(contractId: string, actorId?: string) {
    return this.consentAuthority.run(
      contractId,
      'getPdpaConsent',
      actorId,
      async (tx, contract) => {
        const notice = await currentContractNotice(tx);
        const consent = await linkedContractConsent(tx, contract.pdpaConsentId);
        const visible = consent && consent.customerId === contract.customerId && !consent.deletedAt;
        return {
          notice,
          consent: visible
            ? {
                id: consent.id,
                version: consent.consentVersion,
                status: consent.status,
                grantedAt: consent.grantedAt,
                valid: isValidContractConsent(consent, contract.customerId),
              }
            : null,
        };
      },
    );
  }
}
