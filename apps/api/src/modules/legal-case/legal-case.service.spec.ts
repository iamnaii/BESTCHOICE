import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LegalCaseService } from './legal-case.service';

const mockPrisma = {
  contract: {
    findFirst: jest.fn(),
  },
  legalCase: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  legalCaseDocument: {
    create: jest.fn(),
  },
};

const mockStorage = {
  configured: true,
  getSignedUploadUrl: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
  getPublicUrl: jest.fn(),
};

describe('LegalCaseService', () => {
  let service: LegalCaseService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.legalCase.findUnique.mockResolvedValue(null);
    mockPrisma.legalCase.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'lc-1', documents: [], ...args.data }),
    );
    mockPrisma.legalCase.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
    mockPrisma.legalCase.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.legalCase.findFirst.mockResolvedValue(null);
    mockPrisma.legalCaseDocument.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'd-1', uploadedAt: new Date(), ...args.data }),
    );
    mockStorage.getSignedUploadUrl.mockResolvedValue({ url: 'https://signed/upload', method: 'PUT' });
    mockStorage.getSignedDownloadUrl.mockResolvedValue('https://signed/download');
    mockStorage.getPublicUrl.mockImplementation((k: string) => `https://public/${k}`);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        LegalCaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();
    service = mod.get(LegalCaseService);
  });

  describe('create', () => {
    it('throws NotFoundException when contract missing', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.create('missing', { caseNumber: 'CR-1', court: 'ศาลแพ่ง' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when contract already has active legal case', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.create('c-1', { caseNumber: 'CR-1', court: 'ศาลแพ่ง' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates legal case linked to contract', async () => {
      const out = await service.create('c-1', {
        caseNumber: 'CR-2026-001',
        court: 'ศาลแพ่งกรุงเทพใต้',
        hearingDate: '2026-05-15T09:00:00.000Z',
      });
      expect(out.id).toBe('lc-1');
      const args = mockPrisma.legalCase.create.mock.calls[0][0];
      expect(args.data.contractId).toBe('c-1');
      expect(args.data.caseNumber).toBe('CR-2026-001');
      expect(args.data.hearingDate).toBeInstanceOf(Date);
    });
  });

  describe('findByContract', () => {
    it('returns null when no case exists', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce(null);
      const out = await service.findByContract('c-1');
      expect(out).toBeNull();
    });

    it('returns case with documents', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce({
        id: 'lc-1',
        documents: [{ id: 'd-1' }],
      });
      const out = await service.findByContract('c-1');
      expect(out?.id).toBe('lc-1');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when case missing', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce(null);
      await expect(service.update('c-1', { notes: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates case fields', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce({ id: 'lc-1' });
      const out = await service.update('c-1', { notes: 'updated' });
      expect(mockPrisma.legalCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lc-1' },
          data: expect.objectContaining({ notes: 'updated' }),
        }),
      );
      expect(out).toBeDefined();
    });
  });

  describe('softDelete', () => {
    it('throws NotFoundException when case missing', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce(null);
      await expect(service.softDelete('c-1')).rejects.toThrow(NotFoundException);
    });

    it('sets deletedAt on case', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce({ id: 'lc-1' });
      await service.softDelete('c-1');
      expect(mockPrisma.legalCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lc-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('presignDocumentUpload', () => {
    it('throws when case not found', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.presignDocumentUpload('c-1', {
          contentType: 'application/pdf',
          kind: 'complaint',
          filename: 'a.pdf',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns signed URL + key for legal-case prefix', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce({ id: 'lc-1' });
      const out = await service.presignDocumentUpload('c-1', {
        contentType: 'application/pdf',
        kind: 'complaint',
        filename: 'complaint.pdf',
      });
      expect(out.uploadUrl).toBe('https://signed/upload');
      expect(out.key).toMatch(/^legal-cases\/lc-1\//);
      expect(out.key).toMatch(/\.pdf$/);
    });

    it('uses jpg extension for image/jpeg', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce({ id: 'lc-1' });
      const out = await service.presignDocumentUpload('c-1', {
        contentType: 'image/jpeg',
        kind: 'summons',
        filename: 'summons.jpg',
      });
      expect(out.key).toMatch(/\.jpg$/);
    });
  });

  describe('registerDocument', () => {
    it('throws when case not found', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.registerDocument('c-1', 'user-1', {
          kind: 'complaint',
          filename: 'a.pdf',
          s3Key: 'legal-cases/lc-1/a.pdf',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates document row with uploader', async () => {
      mockPrisma.legalCase.findFirst.mockResolvedValueOnce({ id: 'lc-1' });
      await service.registerDocument('c-1', 'user-9', {
        kind: 'judgment',
        filename: 'judgment.pdf',
        s3Key: 'legal-cases/lc-1/judgment.pdf',
      });
      const args = mockPrisma.legalCaseDocument.create.mock.calls[0][0];
      expect(args.data.legalCaseId).toBe('lc-1');
      expect(args.data.uploadedByUserId).toBe('user-9');
      expect(args.data.kind).toBe('judgment');
      expect(args.data.s3Url).toBe('https://public/legal-cases/lc-1/judgment.pdf');
    });
  });
});
