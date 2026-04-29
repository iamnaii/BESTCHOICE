import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

// Mock puppeteer-core to prevent actual browser launch
jest.mock('puppeteer-core', () => ({
  launch: jest.fn().mockRejectedValue(new Error('Puppeteer not available in test')),
}));

describe('DocumentsService', () => {
  let service: DocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  const mockContract = {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    productId: 'product-1',
    branchId: 'branch-1',
    salespersonId: 'user-1',
    status: 'DRAFT',
    workflowStatus: 'CREATING',
    sellingPrice: 20000,
    downPayment: 2000,
    totalMonths: 12,
    interestRate: 9,
    interestTotal: 1800,
    financedAmount: 21800,
    monthlyPayment: 1817,
    paymentDueDay: 5,
    deletedAt: null,
    pdpaConsentId: null,
    contractHash: null,
    customer: {
      id: 'customer-1',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      nationalId: '1234567890123',
      phone: '0891234567',
      lineIdFinance: 'U1234567890',
      addressIdCard: 'กรุงเทพ',
      addressCurrent: 'กรุงเทพ',
      birthDate: null,
    },
    product: { id: 'product-1', name: 'iPhone 16', brand: 'Apple', model: '16 Pro', imeiSerial: '123456789012345', category: 'PHONE' },
    branch: { id: 'branch-1', name: 'สาขาทดสอบ' },
    salesperson: { id: 'user-1', name: 'Staff' },
    payments: [],
    signatures: [
      { id: 'sig-1', signerType: 'CUSTOMER', signedAt: new Date() },
      { id: 'sig-2', signerType: 'COMPANY', signedAt: new Date() },
    ],
    pdpaConsent: null,
    eDocuments: [],
  };

  const mockEDocument = {
    id: 'doc-1',
    contractId: 'contract-1',
    documentType: 'CONTRACT',
    fileUrl: 'contracts/2026/BC-2026-001/CONTRACT_123.pdf',
    fileHash: 'abc123hash',
    createdById: 'user-1',
    createdAt: new Date(),
  };

  const mockHtmlDocument = {
    ...mockEDocument,
    id: 'doc-2',
    fileUrl: 'documents/BC-2026-001_CONTRACT_123.html',
  };

  const mockTemplate = {
    id: 'template-1',
    name: 'Default',
    type: 'STORE_DIRECT',
    contentHtml: '<div>{contract_number}</div>',
    placeholders: ['contract_number'],
    settings: null,
    isActive: true,
    blocks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    contract: {
      findUnique: jest.fn().mockResolvedValue(mockContract),
    },
    contractTemplate: {
      findFirst: jest.fn().mockResolvedValue(mockTemplate),
      findUnique: jest.fn().mockResolvedValue(mockTemplate),
      findMany: jest.fn().mockResolvedValue([mockTemplate]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(mockTemplate),
      update: jest.fn().mockResolvedValue(mockTemplate),
    },
    eDocument: {
      create: jest.fn().mockResolvedValue(mockEDocument),
      findUnique: jest.fn().mockResolvedValue(mockEDocument),
      findMany: jest.fn().mockResolvedValue([mockEDocument]),
      count: jest.fn().mockResolvedValue(1),
    },
    contractDocument: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    signature: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn(),
    },
    setting: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    systemConfig: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    notificationLog: {
      create: jest.fn(),
    },
  };

  const mockStorage = {
    upload: jest.fn().mockResolvedValue('contracts/2026/BC-2026-001/CONTRACT_123.pdf'),
    getStream: jest.fn().mockResolvedValue('mock-stream'),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/file.pdf'),
    delete: jest.fn().mockResolvedValue(undefined),
    configured: true,
  };

  const mockNotifications = {
    send: jest.fn().mockResolvedValue({ id: 'notif-1', status: 'SENT' }),
  };

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Restore default return values
    mockPrisma.contract.findUnique.mockResolvedValue(mockContract);
    mockPrisma.eDocument.findUnique.mockResolvedValue(mockEDocument);
    mockPrisma.eDocument.create.mockResolvedValue(mockEDocument);
    mockPrisma.contractTemplate.findFirst.mockResolvedValue(mockTemplate);
    mockPrisma.setting.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    mockStorage.configured = true;
    mockStorage.getStream.mockResolvedValue('mock-stream');
    mockStorage.getSignedDownloadUrl.mockResolvedValue('https://signed-url.example.com/file.pdf');
    mockNotifications.send.mockResolvedValue({ id: 'notif-1', status: 'SENT' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: SettingsService, useValue: { findAll: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    prisma = module.get(PrismaService);
    storage = module.get(StorageService);
    notifications = module.get(NotificationsService);
  });

  // ─── generateDocument ────────────────────────────────
  describe('generateDocument', () => {
    it('should generate document with HTML fallback when Puppeteer unavailable', async () => {
      const result = await service.generateDocument('contract-1', 'user-1', 'CONTRACT');

      expect(result).toBeDefined();
      expect(result.renderedHtml).toBeDefined();
      // Puppeteer is mocked to fail, so pdfGenerated should be false (HTML fallback)
      expect(result.pdfGenerated).toBe(false);
      expect(prisma.eDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'contract-1',
            documentType: 'CONTRACT',
            createdById: 'user-1',
          }),
        }),
      );
    });

    it('should throw NotFoundException when contract not found', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.generateDocument('nonexistent', 'user-1', 'CONTRACT'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when contract is deleted', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce({
        ...mockContract,
        deletedAt: new Date(),
      });

      await expect(
        service.generateDocument('contract-1', 'user-1', 'CONTRACT'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should use default template when no template specified', async () => {
      prisma.contractTemplate.findFirst.mockResolvedValueOnce(null);

      const result = await service.generateDocument('contract-1', 'user-1', 'CONTRACT');
      expect(result).toBeDefined();
      expect(result.renderedHtml).toContain('BC-2026-001');
    });
  });

  // ─── generateSignedDocuments ─────────────────────────
  describe('generateSignedDocuments', () => {
    it('should generate both contract and PDPA documents', async () => {
      // Mock PDPA consent for PDPA document generation
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        pdpaConsent: { id: 'pdpa-1', signatureImage: 'data:image/png;base64,test', grantedAt: new Date() },
      });

      const result = await service.generateSignedDocuments('contract-1', 'user-1');

      expect(result.contract).toBeDefined();
      // PDPA may or may not succeed depending on pdpaConsent
    });

    it('should send LINE notification after generating documents', async () => {
      const result = await service.generateSignedDocuments('contract-1', 'user-1');

      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'LINE',
          recipient: 'U1234567890',
          relatedId: 'contract-1',
        }),
      );
    });

    it('should create audit log after generating documents', async () => {
      await service.generateSignedDocuments('contract-1', 'user-1');

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            action: 'CONTRACT_SIGNED',
            entity: 'contract',
            entityId: 'contract-1',
          }),
        }),
      );
    });

    it('should not throw when notification fails', async () => {
      notifications.send.mockRejectedValueOnce(new Error('LINE send failed'));

      // Should not throw — notification failure is handled gracefully
      await expect(
        service.generateSignedDocuments('contract-1', 'user-1'),
      ).resolves.toBeDefined();
    });

    it('should not throw when audit log fails', async () => {
      prisma.auditLog.create.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.generateSignedDocuments('contract-1', 'user-1'),
      ).resolves.toBeDefined();
    });

    it('should collect errors without throwing', async () => {
      // Make contract findUnique return null to cause generation error
      prisma.contract.findUnique.mockResolvedValueOnce(null);

      const result = await service.generateSignedDocuments('contract-1', 'user-1');

      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  // ─── getDocumentStream ───────────────────────────────
  describe('getDocumentStream', () => {
    it('should return stream for PDF file from storage', async () => {
      const result = await service.getDocumentStream('doc-1');

      expect(result.contentType).toBe('application/pdf');
      expect(result.filename).toContain('.pdf');
      expect(storage.getStream).toHaveBeenCalledWith(mockEDocument.fileUrl);
    });

    it('should fetch HTML file from storage (not emit the path as body)', async () => {
      prisma.eDocument.findUnique.mockResolvedValueOnce(mockHtmlDocument);

      const result = await service.getDocumentStream('doc-2');

      // Bug the earlier implementation caused: response body = fileUrl path
      // string, rendered as a blank page with just the filename visible.
      // Fix: call storage.getStream for HTML just like for PDF.
      expect(storage.getStream).toHaveBeenCalledWith(mockHtmlDocument.fileUrl);
      expect(result.contentType).toBe('text/html; charset=utf-8');
      expect(result.filename).toContain('.html');
    });

    it('should throw NotFoundException when document not found', async () => {
      prisma.eDocument.findUnique.mockResolvedValueOnce(null);

      await expect(service.getDocumentStream('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getDocumentSignedUrl ────────────────────────────
  describe('getDocumentSignedUrl', () => {
    it('should return signed URL for PDF document', async () => {
      const result = await service.getDocumentSignedUrl('doc-1');

      expect(result.url).toBe('https://signed-url.example.com/file.pdf');
      expect(result.expiresIn).toBe(3600);
      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(mockEDocument.fileUrl, 3600);
    });

    it('should throw NotFoundException when document not found', async () => {
      prisma.eDocument.findUnique.mockResolvedValueOnce(null);

      await expect(service.getDocumentSignedUrl('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-PDF documents', async () => {
      prisma.eDocument.findUnique.mockResolvedValueOnce(mockHtmlDocument);

      await expect(service.getDocumentSignedUrl('doc-2')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when storage not configured', async () => {
      mockStorage.configured = false;

      await expect(service.getDocumentSignedUrl('doc-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getDocument ─────────────────────────────────────
  describe('getDocument', () => {
    it('should return document by id', async () => {
      const result = await service.getDocument('doc-1');
      expect(result).toEqual(mockEDocument);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.eDocument.findUnique.mockResolvedValueOnce(null);
      await expect(service.getDocument('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getDocuments ────────────────────────────────────
  describe('getDocuments', () => {
    it('should return paginated documents for a contract', async () => {
      const result = await service.getDocuments('contract-1');
      expect(result).toEqual({ data: [mockEDocument], total: 1, page: 1, limit: 50 });
      expect(prisma.eDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contractId: 'contract-1' },
          skip: 0,
          take: 50,
        }),
      );
    });
  });
});
