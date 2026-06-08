import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PDPAService } from './pdpa.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Characterization (golden) spec for PDPAService — pins CURRENT behavior of:
 *  - consent lifecycle: record -> GRANTED -> hasActiveConsent(true) -> revoke -> hasActiveConsent(false)
 *  - DSAR 30-day dueDate computation
 *  - DSAR request-number sequencing (DSAR-YYYY-NNN)
 *  - DSAR submit/process/export compliance correctness (masking, ACCESS auto-export)
 *
 * Mock-based only (no real DB). This asserts behavior as-written; it does NOT fix bugs.
 */

/**
 * Hand-rolled in-memory store backing the prisma mock. Mirrors the sibling
 * pdpa-encryption.service.spec.ts style of a fake prisma cast to jest.Mocked.
 */
interface ConsentRow {
  id: string;
  customerId: string;
  status: 'GRANTED' | 'REVOKED';
  deletedAt: Date | null;
  consentVersion?: string;
  privacyNoticeText?: string;
  purposes?: string[];
  grantedAt?: Date | null;
  revokedAt?: Date | null;
  revokeReason?: string | null;
  ipAddress?: string | null;
  deviceInfo?: string | null;
  signatureImage?: string | null;
  createdAt?: Date;
}

interface CustomerRow {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  nationalId?: string | null;
  deletedAt: Date | null;
  contracts?: unknown[];
  pdpaConsents?: unknown[];
}

interface DsarRow {
  id: string;
  requestNumber: string;
  customerId: string;
  requestType: string;
  description: string;
  status?: string;
  dueDate: Date;
  submittedAt?: Date;
  deletedAt: Date | null;
  responseNotes?: string | null;
  responseData?: unknown;
  processedById?: string | null;
  processedAt?: Date | null;
  completedAt?: Date | null;
}

function makePrismaMock(seed: {
  customers?: CustomerRow[];
  consents?: ConsentRow[];
  contracts?: Array<{
    id: string;
    pdpaConsentId: string;
    deletedAt: Date | null;
    status: string;
    contractNumber: string;
  }>;
  dsarRequests?: DsarRow[];
  systemConfigValue?: string | null;
  /** count() result for dSARRequest.count (request-number sequencing) */
  dsarYearCount?: number;
  /** the customer object returned by generateCustomerDataExport's include query */
  exportCustomer?: CustomerRow | null;
}) {
  const customers = seed.customers ?? [];
  const consents = seed.consents ?? [];
  const contracts = seed.contracts ?? [];
  const dsarRequests = seed.dsarRequests ?? [];

  let consentSeq = consents.length;
  let dsarSeq = dsarRequests.length;

  const prisma = {
    systemConfig: {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve(
          seed.systemConfigValue === undefined
            ? null
            : seed.systemConfigValue === null
              ? null
              : { key: 'pdpa_privacy_notice_version', value: seed.systemConfigValue },
        ),
      ),
    },
    customer: {
      findUnique: jest.fn().mockImplementation((args: { where: { id: string }; include?: unknown }) => {
        // generateCustomerDataExport passes an include — return the export shape.
        if (args.include) {
          return Promise.resolve(
            seed.exportCustomer === undefined
              ? customers.find((c) => c.id === args.where.id) ?? null
              : seed.exportCustomer,
          );
        }
        return Promise.resolve(customers.find((c) => c.id === args.where.id) ?? null);
      }),
    },
    pDPAConsent: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        const row: ConsentRow = {
          id: `consent-${++consentSeq}`,
          deletedAt: null,
          createdAt: new Date(),
          ...(args.data as Partial<ConsentRow>),
        } as ConsentRow;
        consents.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) =>
        Promise.resolve(consents.find((c) => c.id === args.where.id) ?? null),
      ),
      findFirst: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        const w = args.where;
        const found = consents.find(
          (c) =>
            c.customerId === w.customerId &&
            c.status === w.status &&
            (w.deletedAt === null ? c.deletedAt === null : true),
        );
        return Promise.resolve(found ? { id: found.id } : null);
      }),
      findMany: jest.fn().mockImplementation((args: { where: { customerId: string } }) =>
        Promise.resolve(
          consents.filter((c) => c.customerId === args.where.customerId && c.deletedAt === null),
        ),
      ),
      update: jest.fn().mockImplementation((args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = consents.find((c) => c.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
    },
    contract: {
      findFirst: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        const w = args.where;
        const statuses = (w.status as { in?: string[] })?.in ?? [];
        const found = contracts.find(
          (k) =>
            k.pdpaConsentId === w.pdpaConsentId &&
            k.deletedAt === null &&
            statuses.includes(k.status),
        );
        return Promise.resolve(found ?? null);
      }),
    },
    dSARRequest: {
      count: jest.fn().mockImplementation(() => Promise.resolve(seed.dsarYearCount ?? dsarRequests.length)),
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        const row: DsarRow = {
          id: `dsar-${++dsarSeq}`,
          status: 'SUBMITTED',
          deletedAt: null,
          submittedAt: new Date(),
          ...(args.data as Partial<DsarRow>),
        } as DsarRow;
        dsarRequests.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) =>
        Promise.resolve(dsarRequests.find((d) => d.id === args.where.id) ?? null),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation((args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = dsarRequests.find((d) => d.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return Promise.resolve(row);
      }),
    },
  };

  return prisma as unknown as jest.Mocked<PrismaService> & typeof prisma;
}

describe('PDPAService (characterization)', () => {
  describe('getPrivacyNotice', () => {
    it('returns version from systemConfig when present + the default Thai privacy notice text', async () => {
      const prisma = makePrismaMock({ systemConfigValue: '2.5' });
      const svc = new PDPAService(prisma);

      const notice = await svc.getPrivacyNotice();

      expect(notice.version).toBe('2.5');
      expect(notice.text).toContain('ประกาศความเป็นส่วนตัว (Privacy Notice)');
      expect(notice.text).toContain('บริษัท เบสท์ช้อยส์โฟน จำกัด');
    });

    it('falls back to version "1.0" when systemConfig key is missing', async () => {
      const prisma = makePrismaMock({ systemConfigValue: null });
      const svc = new PDPAService(prisma);

      const notice = await svc.getPrivacyNotice();

      expect(notice.version).toBe('1.0');
    });
  });

  describe('recordConsent', () => {
    it('creates a GRANTED consent stamped with version, fixed purposes, ip/device/signature', async () => {
      const prisma = makePrismaMock({
        customers: [{ id: 'cust-1', deletedAt: null }],
        systemConfigValue: '1.0',
      });
      const svc = new PDPAService(prisma);

      const consent = await svc.recordConsent(
        'cust-1',
        { ip: '10.0.0.9', userAgent: 'Jest/UA' },
        'data:image/png;base64,AAAA',
      );

      expect(prisma.pDPAConsent.create).toHaveBeenCalledTimes(1);
      const data = prisma.pDPAConsent.create.mock.calls[0][0].data;
      expect(data.customerId).toBe('cust-1');
      expect(data.status).toBe('GRANTED');
      expect(data.consentVersion).toBe('1.0');
      expect(data.grantedAt).toBeInstanceOf(Date);
      expect(data.ipAddress).toBe('10.0.0.9');
      expect(data.deviceInfo).toBe('Jest/UA');
      expect(data.signatureImage).toBe('data:image/png;base64,AAAA');
      // Pin the exact purposes list (compliance-relevant)
      expect(data.purposes).toEqual([
        'สัญญาผ่อนชำระสินค้า',
        'ติดตามหนี้และบริหารสัญญา',
        'จัดทำเอกสารทางกฎหมาย',
        'ติดต่อสื่อสารเกี่ยวกับสัญญา',
      ]);
      expect(consent.status).toBe('GRANTED');
    });

    it('coalesces missing ip/userAgent/signature to null', async () => {
      const prisma = makePrismaMock({
        customers: [{ id: 'cust-1', deletedAt: null }],
        systemConfigValue: null,
      });
      const svc = new PDPAService(prisma);

      await svc.recordConsent('cust-1', {});

      const data = prisma.pDPAConsent.create.mock.calls[0][0].data;
      expect(data.ipAddress).toBeNull();
      expect(data.deviceInfo).toBeNull();
      expect(data.signatureImage).toBeNull();
      expect(data.consentVersion).toBe('1.0');
    });

    it('throws NotFoundException when customer does not exist', async () => {
      const prisma = makePrismaMock({ customers: [] });
      const svc = new PDPAService(prisma);

      await expect(svc.recordConsent('ghost', {})).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.pDPAConsent.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when customer is soft-deleted', async () => {
      const prisma = makePrismaMock({
        customers: [{ id: 'cust-1', deletedAt: new Date() }],
      });
      const svc = new PDPAService(prisma);

      await expect(svc.recordConsent('cust-1', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('hasActiveConsent', () => {
    it('returns true when a GRANTED non-deleted consent exists', async () => {
      const prisma = makePrismaMock({
        consents: [{ id: 'c1', customerId: 'cust-1', status: 'GRANTED', deletedAt: null }],
      });
      const svc = new PDPAService(prisma);

      await expect(svc.hasActiveConsent('cust-1')).resolves.toBe(true);
    });

    it('returns false when the only consent is REVOKED', async () => {
      const prisma = makePrismaMock({
        consents: [{ id: 'c1', customerId: 'cust-1', status: 'REVOKED', deletedAt: null }],
      });
      const svc = new PDPAService(prisma);

      await expect(svc.hasActiveConsent('cust-1')).resolves.toBe(false);
    });

    it('returns false when no consent exists for the customer', async () => {
      const prisma = makePrismaMock({ consents: [] });
      const svc = new PDPAService(prisma);

      await expect(svc.hasActiveConsent('cust-1')).resolves.toBe(false);
    });
  });

  describe('consent lifecycle: record -> active -> revoke flips hasActiveConsent', () => {
    it('record makes hasActiveConsent true; revoke flips it to false', async () => {
      const prisma = makePrismaMock({
        customers: [{ id: 'cust-1', deletedAt: null }],
        systemConfigValue: '1.0',
      });
      const svc = new PDPAService(prisma);

      // 1) Before recording — no active consent
      await expect(svc.hasActiveConsent('cust-1')).resolves.toBe(false);

      // 2) Record consent — now GRANTED + active
      const consent = await svc.recordConsent('cust-1', { ip: '1.1.1.1' });
      expect(consent.status).toBe('GRANTED');
      await expect(svc.hasActiveConsent('cust-1')).resolves.toBe(true);

      // 3) Revoke — status becomes REVOKED, revokedAt + reason set
      const revoked = await svc.revokeConsent(consent.id, 'ลูกค้าขอเพิกถอน');
      expect(revoked.status).toBe('REVOKED');
      expect(revoked.revokedAt).toBeInstanceOf(Date);
      expect(revoked.revokeReason).toBe('ลูกค้าขอเพิกถอน');

      // 4) After revoke — hasActiveConsent flips back to false
      await expect(svc.hasActiveConsent('cust-1')).resolves.toBe(false);
    });
  });

  describe('revokeConsent guards', () => {
    it('throws NotFoundException for unknown consent', async () => {
      const prisma = makePrismaMock({ consents: [] });
      const svc = new PDPAService(prisma);

      await expect(svc.revokeConsent('nope', 'r')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted consent', async () => {
      const prisma = makePrismaMock({
        consents: [{ id: 'c1', customerId: 'cust-1', status: 'GRANTED', deletedAt: new Date() }],
      });
      const svc = new PDPAService(prisma);

      await expect(svc.revokeConsent('c1', 'r')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when consent is already REVOKED', async () => {
      const prisma = makePrismaMock({
        consents: [{ id: 'c1', customerId: 'cust-1', status: 'REVOKED', deletedAt: null }],
      });
      const svc = new PDPAService(prisma);

      await expect(svc.revokeConsent('c1', 'r')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks revoke when an ACTIVE contract is linked to the consent (includes contract number)', async () => {
      const prisma = makePrismaMock({
        consents: [{ id: 'c1', customerId: 'cust-1', status: 'GRANTED', deletedAt: null }],
        contracts: [
          {
            id: 'k1',
            pdpaConsentId: 'c1',
            deletedAt: null,
            status: 'ACTIVE',
            contractNumber: 'CT-2026-001',
          },
        ],
      });
      const svc = new PDPAService(prisma);

      await expect(svc.revokeConsent('c1', 'r')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.revokeConsent('c1', 'r')).rejects.toThrow('CT-2026-001');
      expect(prisma.pDPAConsent.update).not.toHaveBeenCalled();
    });

    it('allows revoke when the linked contract is CLOSED (not in ACTIVE/OVERDUE/DEFAULT)', async () => {
      const prisma = makePrismaMock({
        consents: [{ id: 'c1', customerId: 'cust-1', status: 'GRANTED', deletedAt: null }],
        contracts: [
          {
            id: 'k1',
            pdpaConsentId: 'c1',
            deletedAt: null,
            status: 'CLOSED',
            contractNumber: 'CT-2026-002',
          },
        ],
      });
      const svc = new PDPAService(prisma);

      const revoked = await svc.revokeConsent('c1', 'done');
      expect(revoked.status).toBe('REVOKED');
    });
  });

  describe('submitDSAR — request-number sequencing + 30-day dueDate', () => {
    it('throws NotFoundException when customer is missing', async () => {
      const prisma = makePrismaMock({ customers: [] });
      const svc = new PDPAService(prisma);

      await expect(svc.submitDSAR('ghost', 'ACCESS', 'desc')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('computes requestNumber as DSAR-{year}-{(count+1) padStart(3,"0")}', async () => {
      const prisma = makePrismaMock({
        customers: [{ id: 'cust-1', deletedAt: null }],
        dsarYearCount: 0,
      });
      const svc = new PDPAService(prisma);

      const year = new Date().getFullYear();
      const created = await svc.submitDSAR('cust-1', 'ACCESS', 'ขอเข้าถึงข้อมูล');

      expect(created.requestNumber).toBe(`DSAR-${year}-001`);
      expect(prisma.dSARRequest.create).toHaveBeenCalledTimes(1);
    });

    it('sequences the next number off the existing year count (count=7 -> 008)', async () => {
      const prisma = makePrismaMock({
        customers: [{ id: 'cust-1', deletedAt: null }],
        dsarYearCount: 7,
      });
      const svc = new PDPAService(prisma);

      const year = new Date().getFullYear();
      const created = await svc.submitDSAR('cust-1', 'DELETION', 'ขอลบข้อมูล');

      expect(created.requestNumber).toBe(`DSAR-${year}-008`);
    });

    it('sets dueDate to exactly 30 days after submission', async () => {
      jest.useFakeTimers();
      // Mid-month to avoid month-boundary ambiguity in the assertion.
      const fixedNow = new Date('2026-06-10T08:00:00.000Z');
      jest.setSystemTime(fixedNow);
      try {
        const prisma = makePrismaMock({
          customers: [{ id: 'cust-1', deletedAt: null }],
          dsarYearCount: 0,
        });
        const svc = new PDPAService(prisma);

        const created = await svc.submitDSAR('cust-1', 'ACCESS', 'desc');

        // Service computes dueDate = new Date(); dueDate.setDate(getDate()+30)
        const expected = new Date(fixedNow);
        expected.setDate(expected.getDate() + 30);
        expect((created.dueDate as Date).getTime()).toBe(expected.getTime());
        // 30 days = 30 * 86_400_000 ms (no DST in UTC fake-timer)
        expect((created.dueDate as Date).getTime() - fixedNow.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
      } finally {
        jest.useRealTimers();
      }
    });

    it('passes requestType through to the create call (cast to DSARRequestType)', async () => {
      const prisma = makePrismaMock({
        customers: [{ id: 'cust-1', deletedAt: null }],
        dsarYearCount: 0,
      });
      const svc = new PDPAService(prisma);

      await svc.submitDSAR('cust-1', 'OBJECTION', 'คัดค้านการประมวลผล');

      const data = prisma.dSARRequest.create.mock.calls[0][0].data;
      expect(data.requestType).toBe('OBJECTION');
      expect(data.description).toBe('คัดค้านการประมวลผล');
      expect(data.customerId).toBe('cust-1');
    });
  });

  describe('processDSAR', () => {
    it('throws NotFoundException for unknown request', async () => {
      const prisma = makePrismaMock({ dsarRequests: [] });
      const svc = new PDPAService(prisma);

      await expect(svc.processDSAR('nope', 'u1', 'IN_PROGRESS', 'notes')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('sets status/responseNotes/processedById/processedAt and NOT completedAt for non-COMPLETED', async () => {
      const prisma = makePrismaMock({
        dsarRequests: [
          {
            id: 'd1',
            requestNumber: 'DSAR-2026-001',
            customerId: 'cust-1',
            requestType: 'DELETION',
            description: 'desc',
            dueDate: new Date(),
            deletedAt: null,
          },
        ],
      });
      const svc = new PDPAService(prisma);

      await svc.processDSAR('d1', 'user-9', 'IN_PROGRESS', 'กำลังดำเนินการ');

      const data = prisma.dSARRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('IN_PROGRESS');
      expect(data.responseNotes).toBe('กำลังดำเนินการ');
      expect(data.processedById).toBe('user-9');
      expect(data.processedAt).toBeInstanceOf(Date);
      expect(data.completedAt).toBeUndefined();
      // Non-ACCESS request: no auto-export
      expect(data.responseData).toBeUndefined();
    });

    it('sets completedAt when status === COMPLETED', async () => {
      const prisma = makePrismaMock({
        dsarRequests: [
          {
            id: 'd1',
            requestNumber: 'DSAR-2026-001',
            customerId: 'cust-1',
            requestType: 'DELETION',
            description: 'desc',
            dueDate: new Date(),
            deletedAt: null,
          },
        ],
      });
      const svc = new PDPAService(prisma);

      await svc.processDSAR('d1', 'user-9', 'COMPLETED', 'เสร็จสิ้น');

      const data = prisma.dSARRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('COMPLETED');
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it('auto-generates a data export (responseData) for ACCESS requests', async () => {
      const prisma = makePrismaMock({
        dsarRequests: [
          {
            id: 'd1',
            requestNumber: 'DSAR-2026-001',
            customerId: 'cust-1',
            requestType: 'ACCESS',
            description: 'desc',
            dueDate: new Date(),
            deletedAt: null,
          },
        ],
        exportCustomer: {
          id: 'cust-1',
          name: 'สมชาย ใจดี',
          phone: '0812345678',
          email: 'a@b.co',
          nationalId: '1234567890123',
          deletedAt: null,
          contracts: [],
          pdpaConsents: [],
        },
      });
      const svc = new PDPAService(prisma);

      await svc.processDSAR('d1', 'user-9', 'COMPLETED', 'ส่งข้อมูลแล้ว');

      const data = prisma.dSARRequest.update.mock.calls[0][0].data;
      expect(data.responseData).toBeDefined();
      const exp = data.responseData as { customer: { nationalIdMasked: string | null; name: string } };
      // Compliance: nationalId must be masked, never raw
      expect(exp.customer.nationalIdMasked).toBe('****0123');
      expect(exp.customer.name).toBe('สมชาย ใจดี');
    });
  });

  describe('generateCustomerDataExport', () => {
    it('masks nationalId to ****<last4> and excludes the raw nationalId', async () => {
      const prisma = makePrismaMock({
        exportCustomer: {
          id: 'cust-1',
          name: 'ทดสอบ',
          phone: '0899999999',
          email: 'x@y.z',
          nationalId: '9876543210987',
          deletedAt: null,
          contracts: [{ contractNumber: 'CT-1' }],
          pdpaConsents: [{ status: 'GRANTED' }],
        },
      });
      const svc = new PDPAService(prisma);

      const result = await svc.generateCustomerDataExport('cust-1');

      expect(result.customer.nationalIdMasked).toBe('****0987');
      expect((result.customer as Record<string, unknown>).nationalId).toBeUndefined();
      expect(result.customer.name).toBe('ทดสอบ');
      expect(result.contracts).toEqual([{ contractNumber: 'CT-1' }]);
      expect(result.consents).toEqual([{ status: 'GRANTED' }]);
      expect(typeof result.exportDate).toBe('string');
    });

    it('returns nationalIdMasked = null when customer has no nationalId', async () => {
      const prisma = makePrismaMock({
        exportCustomer: {
          id: 'cust-1',
          name: 'NoId',
          phone: null,
          email: null,
          nationalId: null,
          deletedAt: null,
          contracts: [],
          pdpaConsents: [],
        },
      });
      const svc = new PDPAService(prisma);

      const result = await svc.generateCustomerDataExport('cust-1');
      expect(result.customer.nationalIdMasked).toBeNull();
    });

    it('throws NotFoundException when customer is not found', async () => {
      const prisma = makePrismaMock({ exportCustomer: null });
      const svc = new PDPAService(prisma);

      await expect(svc.generateCustomerDataExport('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
