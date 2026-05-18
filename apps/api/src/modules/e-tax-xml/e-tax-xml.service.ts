import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ETaxSubmissionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { decryptPII, isEncrypted } from '../../utils/crypto.util';
import { EtaxUblBuilder, EtaxInvoiceInput } from './xml-builder/etax-ubl-2-1.builder';
import { Pkcs7Signer } from './signer/pkcs7-signer';
import { RdApiClient, RdSubmitConfig } from './rd-client/rd-api.client';

/**
 * P2-SP5 — e-Tax XML submission service.
 *
 * Orchestrates the lifecycle:
 *   generateForPayment → signSubmission → submitToRd → pollStatus
 *
 * Without cert/RD creds (default `ETAX_SUBMIT_MODE=disabled`):
 *   - generateForPayment WORKS (XML output for inspection / archive)
 *   - signSubmission throws BadRequestException
 *   - submitToRd throws BadRequestException
 *   - cron auto-submit is a no-op
 *
 * Cert + RD creds are read from the encrypted `e-tax` integration in
 * SystemConfig (falls back to env vars per IntegrationConfigService
 * priority). Service does NOT directly touch env or the filesystem
 * beyond what Pkcs7Signer needs.
 */
@Injectable()
export class ETaxXmlService {
  private readonly logger = new Logger(ETaxXmlService.name);
  private readonly builder = new EtaxUblBuilder();
  private readonly signer = new Pkcs7Signer();
  private readonly rdClient = new RdApiClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationConfig: IntegrationConfigService,
  ) {}

  /** Resolve the FINANCE CompanyInfo row — single VAT-registered entity. */
  private async getFinanceCompany() {
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: {
        id: true,
        nameTh: true,
        nameEn: true,
        taxId: true,
        taxBranchCode: true,
        address: true,
      },
    });
    if (!company) {
      throw new BadRequestException(
        'ไม่พบข้อมูลบริษัท FINANCE — กรุณาตั้งค่าใน /settings#company ก่อน',
      );
    }
    return company;
  }

  /**
   * Load Payment + Contract + Customer; reject if no VAT amount.
   * Used by both XML generation and status displays.
   *
   * C1 — Customer.nationalId is the LEGACY plaintext column and may be
   * null on rows created after the PII migration. Real ID lives in
   * `nationalIdEncrypted`. We load both, decrypt with the project's
   * INTEGRATION_ENCRYPTION_KEY equivalent (here: PII_ENCRYPTION_KEY env
   * which the existing customers.service uses), and return the
   * server-side decrypted value. Never log the decrypted ID.
   */
  private async loadPaymentForXml(paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      select: {
        id: true,
        paidDate: true,
        installmentNo: true,
        amountPaid: true,
        vatAmount: true,
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: {
              select: {
                id: true,
                name: true,
                nationalId: true,
                nationalIdEncrypted: true,
                addressIdCard: true,
                addressIdCardEncrypted: true,
              },
            },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    if (!payment.vatAmount || payment.vatAmount.lte(0)) {
      throw new BadRequestException('รายการนี้ไม่มี VAT — ไม่ต้องออก e-Tax');
    }
    return payment;
  }

  /**
   * C1 — Resolve customer PII (nationalId, addressIdCard) decrypted. Prefers
   * the encrypted column; falls back to legacy plaintext when encrypted is
   * NULL (rolling-deploy safety, mirrors customers.service.decryptCustomerPII).
   * Never logs the decrypted value.
   */
  private resolveCustomerPII(c: {
    nationalId: string | null;
    nationalIdEncrypted: string | null;
    addressIdCard: string | null;
    addressIdCardEncrypted: string | null;
  }): { nationalId: string | null; addressIdCard: string | null } {
    const key = process.env.PII_ENCRYPTION_KEY ?? '';
    const dec = (
      encrypted: string | null,
      legacy: string | null,
    ): string | null => {
      if (encrypted && key && isEncrypted(encrypted)) {
        return decryptPII(encrypted, key);
      }
      return legacy ?? null;
    };
    return {
      nationalId: dec(c.nationalIdEncrypted, c.nationalId),
      addressIdCard: dec(c.addressIdCardEncrypted, c.addressIdCard),
    };
  }

  /**
   * C7 — Allocate the next sequential e-Tax invoice number for the given
   * BKK day. `ET-YYYYMMDD-NNNN` with a 4-digit counter that resets at BKK
   * midnight, race-safe via PostgreSQL advisory lock (mirrors
   * DocNumberService convention in apps/api/src/modules/other-income/).
   *
   * MUST run inside a transaction (advisory lock is per-tx).
   */
  private async nextInvoiceNumber(
    tx: Prisma.TransactionClient,
    issueDate: Date,
  ): Promise<string> {
    const yyyymmdd = issueDate
      .toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
      .replace(/-/g, '');

    // Stable hash for advisory lock key — namespaced under `etax`.
    const lockSeed = `etax:${yyyymmdd}`;
    let lockKey = 0;
    for (let i = 0; i < lockSeed.length; i++) {
      lockKey = (lockKey * 31 + lockSeed.charCodeAt(i)) | 0;
    }
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.eTaxSubmission.findFirst({
      where: { invoiceNumber: { startsWith: `ET-${yyyymmdd}-` } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });

    const lastSeq = last?.invoiceNumber
      ? parseInt(last.invoiceNumber.split('-')[2], 10) || 0
      : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `ET-${yyyymmdd}-${seq}`;
  }

  /**
   * Generate (or return existing) UBL 2.1 XML for the given Payment.
   * Idempotent — if an ETaxSubmission row already exists (any status),
   * return it without regenerating to preserve the original document.
   *
   * C7 — Invoice number is allocated once inside the transaction via
   * `nextInvoiceNumber` (advisory-locked sequential per BKK day). Retries
   * for an already-existing submission reuse the stored `invoiceNumber`,
   * never re-allocate (ม.86/4 sequential constraint).
   */
  async generateForPayment(paymentId: string, userId: string) {
    // Idempotency check first — never regenerate after the fact
    const existing = await this.prisma.eTaxSubmission.findFirst({
      where: { paymentId, deletedAt: null },
    });
    if (existing) {
      this.logger.log(
        `generateForPayment: returning existing submission ${existing.id} for payment ${paymentId}`,
      );
      return existing;
    }

    const payment = await this.loadPaymentForXml(paymentId);
    const finance = await this.getFinanceCompany();
    // C1 — decrypt PII server-side; never trust the legacy plaintext column alone.
    const customerPII = this.resolveCustomerPII(payment.contract.customer);

    const total = payment.amountPaid;
    const vat = payment.vatAmount as Prisma.Decimal;
    const base = total.sub(vat);

    const issueDate = payment.paidDate ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      // C7 — allocate inside the tx; advisory lock prevents two concurrent
      // generates on the same day from clashing on the unique constraint.
      const invoiceNumber = await this.nextInvoiceNumber(tx, issueDate);

      const input: EtaxInvoiceInput = {
        invoiceNumber,
        issueDate,
        currency: 'THB',
        invoiceTypeCode: '388',
        buyerReference: `${payment.contract.contractNumber}/${payment.installmentNo}`,
        supplier: {
          // C5/C6 — branch code is per-CompanyInfo, default '00000' on HQ
          taxId: finance.taxId,
          branchCode: finance.taxBranchCode,
          nameTh: finance.nameTh,
          nameEn: finance.nameEn,
          address: finance.address,
        },
        customer: {
          taxId: customerPII.nationalId,
          name: payment.contract.customer.name,
          address: customerPII.addressIdCard,
        },
        lines: [
          {
            id: '1',
            description: `ค่างวดสัญญา ${payment.contract.contractNumber} งวดที่ ${payment.installmentNo}`,
            quantity: 1,
            unitPrice: base,
            lineExtension: base,
          },
        ],
        lineExtensionAmount: base,
        taxExclusiveAmount: base,
        vatAmount: vat,
        vatPercent: 7,
        taxInclusiveAmount: total,
        payableAmount: total,
      };

      const xml = this.builder.build(input);

      const created = await tx.eTaxSubmission.create({
        data: {
          paymentId,
          invoiceNumber,
          xmlContent: xml,
          status: ETaxSubmissionStatus.PENDING,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ETAX_XML_GENERATED',
          entity: 'etax_submission',
          entityId: created.id,
          newValue: { paymentId, invoiceNumber, status: 'PENDING' },
        },
      });
      return created;
    });
  }

  /** Read submit mode (DB → env → default 'disabled'). */
  private async getSubmitMode(): Promise<'disabled' | 'enabled'> {
    const mode = await this.integrationConfig.getValue('e-tax', 'submitMode');
    return mode === 'enabled' ? 'enabled' : 'disabled';
  }

  /**
   * C3 — Public read used by FM/ACCOUNTANT-accessible
   * `GET /e-tax-xml/submit-mode`. Maps the binary submitMode (disabled |
   * enabled) and the RD endpoint domain to a 3-value status so the UI can
   * distinguish sandbox vs production. No secrets leaked.
   */
  async getSubmitModeStatus(): Promise<{ mode: 'disabled' | 'sandbox' | 'prod' }> {
    const mode = await this.getSubmitMode();
    if (mode === 'disabled') return { mode: 'disabled' };
    const endpoint =
      (await this.integrationConfig.getValue('e-tax', 'rdEndpoint')) ?? '';
    // RD's production endpoint host is `etax.rd.go.th/etax_v2/...`; sandbox
    // is `etax.rd.go.th/etax_staging/...`. Default to sandbox when the
    // path doesn't include `etax_v2`.
    const isProd = endpoint.toLowerCase().includes('etax_v2');
    return { mode: isProd ? 'prod' : 'sandbox' };
  }

  /** Read cert config (DB → env). */
  private async getCertConfig(): Promise<{ certPath: string; certPassword: string }> {
    const certPath = (await this.integrationConfig.getValue('e-tax', 'certPath')) ?? '';
    const certPassword =
      (await this.integrationConfig.getValue('e-tax', 'certPassword')) ?? '';
    return { certPath, certPassword };
  }

  /** Read RD endpoint + creds. */
  private async getRdConfig(): Promise<RdSubmitConfig> {
    return {
      endpoint:
        (await this.integrationConfig.getValue('e-tax', 'rdEndpoint')) ??
        'https://etax.rd.go.th/etax_staging/etaxws',
      username: (await this.integrationConfig.getValue('e-tax', 'rdUsername')) ?? '',
      password: (await this.integrationConfig.getValue('e-tax', 'rdPassword')) ?? '',
    };
  }

  /**
   * Sign a PENDING submission. Throws if cert not configured.
   */
  async signSubmission(submissionId: string, userId: string) {
    const sub = await this.prisma.eTaxSubmission.findFirst({
      where: { id: submissionId, deletedAt: null },
    });
    if (!sub) throw new NotFoundException('ไม่พบรายการ submission');
    if (sub.status !== ETaxSubmissionStatus.PENDING) {
      throw new BadRequestException(
        `รายการนี้สถานะ ${sub.status} — ไม่สามารถเซ็นซ้ำได้`,
      );
    }

    const mode = await this.getSubmitMode();
    if (mode !== 'enabled') {
      throw new BadRequestException(
        'e-Tax ปิดอยู่ (ETAX_SUBMIT_MODE=disabled) — เปิดที่ /settings/e-tax-config ก่อน',
      );
    }

    const { certPath, certPassword } = await this.getCertConfig();
    const signedXml = await this.signer.sign(sub.xmlContent, certPath, certPassword);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.eTaxSubmission.update({
        where: { id: submissionId },
        data: { signedXml, status: ETaxSubmissionStatus.SIGNED },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ETAX_SIGNED',
          entity: 'etax_submission',
          entityId: submissionId,
          oldValue: { status: 'PENDING' },
          newValue: { status: 'SIGNED' },
        },
      });
      return updated;
    });
  }

  /**
   * Submit a SIGNED submission to RD. Throws if cert/creds not configured.
   */
  async submitToRd(submissionId: string, userId: string) {
    const sub = await this.prisma.eTaxSubmission.findFirst({
      where: { id: submissionId, deletedAt: null },
    });
    if (!sub) throw new NotFoundException('ไม่พบรายการ submission');
    if (
      sub.status !== ETaxSubmissionStatus.SIGNED &&
      sub.status !== ETaxSubmissionStatus.ERROR
    ) {
      throw new BadRequestException(
        `รายการนี้สถานะ ${sub.status} — ส่งให้สรรพากรไม่ได้ (ต้อง SIGNED หรือ ERROR)`,
      );
    }
    if (!sub.signedXml) {
      throw new BadRequestException('ยังไม่ได้เซ็น XML — โปรดเซ็นก่อน');
    }

    const mode = await this.getSubmitMode();
    if (mode !== 'enabled') {
      throw new BadRequestException(
        'e-Tax ปิดอยู่ (ETAX_SUBMIT_MODE=disabled) — เปิดที่ /settings/e-tax-config ก่อน',
      );
    }

    const rdConfig = await this.getRdConfig();
    let result;
    try {
      result = await this.rdClient.submit(sub.signedXml, rdConfig);
    } catch (err) {
      // Transport / timeout — mark ERROR for retry, capture audit
      const updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.eTaxSubmission.update({
          where: { id: submissionId },
          data: {
            status: ETaxSubmissionStatus.ERROR,
            retryCount: { increment: 1 },
            lastRetryAt: new Date(),
            rdResponse: { error: (err as Error).message } as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'ETAX_SUBMIT_FAILED',
            entity: 'etax_submission',
            entityId: submissionId,
            newValue: { error: (err as Error).message },
          },
        });
        return u;
      });
      return updated;
    }

    return this.prisma.$transaction(async (tx) => {
      const newStatus = result.accepted
        ? ETaxSubmissionStatus.SUBMITTED // RD accepted into queue; verdict via polling
        : ETaxSubmissionStatus.REJECTED;

      const updated = await tx.eTaxSubmission.update({
        where: { id: submissionId },
        data: {
          status: newStatus,
          submittedAt: new Date(),
          rdSubmissionId: result.submissionId ?? null,
          rejectedAt: result.accepted ? null : new Date(),
          rejectReason: result.accepted ? null : (result.reason ?? null),
          rdResponse: result.rawResponse as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: result.accepted ? 'ETAX_SUBMITTED' : 'ETAX_REJECTED',
          entity: 'etax_submission',
          entityId: submissionId,
          oldValue: { status: sub.status },
          newValue: {
            status: newStatus,
            rdSubmissionId: result.submissionId,
            reason: result.reason,
          },
        },
      });
      return updated;
    });
  }

  /**
   * Poll RD for status — moves SUBMITTED → ACCEPTED or REJECTED.
   */
  async pollStatus(submissionId: string, userId: string) {
    const sub = await this.prisma.eTaxSubmission.findFirst({
      where: { id: submissionId, deletedAt: null },
    });
    if (!sub) throw new NotFoundException('ไม่พบรายการ submission');
    if (sub.status !== ETaxSubmissionStatus.SUBMITTED) {
      // Polling only makes sense in SUBMITTED state.
      return sub;
    }
    if (!sub.rdSubmissionId) {
      throw new BadRequestException('ไม่มี RD submission ID — ไม่สามารถ poll ได้');
    }

    const mode = await this.getSubmitMode();
    if (mode !== 'enabled') return sub;

    const rdConfig = await this.getRdConfig();
    const result = await this.rdClient.checkStatus(sub.rdSubmissionId, rdConfig);
    if (result.status === 'PENDING') return sub; // no change yet

    return this.prisma.$transaction(async (tx) => {
      const newStatus =
        result.status === 'ACCEPTED'
          ? ETaxSubmissionStatus.ACCEPTED
          : ETaxSubmissionStatus.REJECTED;

      const updated = await tx.eTaxSubmission.update({
        where: { id: submissionId },
        data: {
          status: newStatus,
          acceptedAt: result.status === 'ACCEPTED' ? new Date() : null,
          rejectedAt: result.status === 'REJECTED' ? new Date() : null,
          rejectReason: result.status === 'REJECTED' ? (result.reason ?? null) : null,
          rdResponse: result.rawResponse as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action:
            result.status === 'ACCEPTED' ? 'ETAX_ACCEPTED' : 'ETAX_REJECTED',
          entity: 'etax_submission',
          entityId: submissionId,
          oldValue: { status: 'SUBMITTED' },
          newValue: { status: newStatus, reason: result.reason },
        },
      });
      return updated;
    });
  }

  /**
   * Retry a REJECTED / ERROR submission — moves back to SIGNED so the
   * caller can re-trigger submitToRd. (We don't auto-resubmit here to
   * keep the audit trail clean — caller does the submit.)
   */
  async retrySubmission(submissionId: string, userId: string) {
    const sub = await this.prisma.eTaxSubmission.findFirst({
      where: { id: submissionId, deletedAt: null },
    });
    if (!sub) throw new NotFoundException('ไม่พบรายการ submission');
    if (
      sub.status !== ETaxSubmissionStatus.REJECTED &&
      sub.status !== ETaxSubmissionStatus.ERROR
    ) {
      throw new BadRequestException(
        `retry รองรับเฉพาะ REJECTED / ERROR — สถานะปัจจุบัน ${sub.status}`,
      );
    }
    if (!sub.signedXml) {
      throw new BadRequestException('ไม่มี signed XML — เซ็นใหม่ก่อน');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.eTaxSubmission.update({
        where: { id: submissionId },
        data: {
          status: ETaxSubmissionStatus.SIGNED,
          rejectedAt: null,
          rejectReason: null,
          retryCount: { increment: 1 },
          lastRetryAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ETAX_RETRY',
          entity: 'etax_submission',
          entityId: submissionId,
          oldValue: { status: sub.status },
          newValue: { status: 'SIGNED', retryCount: sub.retryCount + 1 },
        },
      });
      return updated;
    });
  }

  /**
   * Verify that cert + RD endpoint are reachable.
   * Used by "ทดสอบการเชื่อมต่อ" button.
   */
  async checkConfig(): Promise<{
    submitMode: 'disabled' | 'enabled';
    certConfigured: boolean;
    certError?: string;
    rdReachable: boolean;
    rdDetail: string;
  }> {
    const mode = await this.getSubmitMode();
    const { certPath, certPassword } = await this.getCertConfig();

    let certConfigured = false;
    let certError: string | undefined;
    if (certPath && certPassword) {
      try {
        await this.signer.loadPfx(certPath, certPassword);
        certConfigured = true;
      } catch (err) {
        certError = (err as Error).message;
      }
    } else {
      certError = 'certPath หรือ certPassword ไม่ได้ตั้งค่า';
    }

    const rdConfig = await this.getRdConfig();
    const rdProbe = await this.rdClient.ping(rdConfig);

    return {
      submitMode: mode,
      certConfigured,
      certError,
      rdReachable: rdProbe.ok,
      rdDetail: rdProbe.detail,
    };
  }

  /** Find by ID — for the GET /e-tax-xml/:id endpoint */
  async findOne(id: string) {
    const sub = await this.prisma.eTaxSubmission.findFirst({
      where: { id, deletedAt: null },
      include: {
        payment: {
          select: {
            id: true,
            installmentNo: true,
            paidDate: true,
            amountPaid: true,
            vatAmount: true,
            contract: {
              select: {
                id: true,
                contractNumber: true,
                customer: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!sub) throw new NotFoundException('ไม่พบรายการ submission');
    return sub;
  }

  /** List submissions w/ filters — basic pagination per backend conventions */
  async findAll(opts: {
    status?: ETaxSubmissionStatus;
    page?: number;
    limit?: number;
  }) {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 200);

    const where: Prisma.ETaxSubmissionWhereInput = {
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.eTaxSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          payment: {
            select: {
              id: true,
              installmentNo: true,
              paidDate: true,
              amountPaid: true,
              vatAmount: true,
              contract: {
                select: {
                  contractNumber: true,
                  customer: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.eTaxSubmission.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
