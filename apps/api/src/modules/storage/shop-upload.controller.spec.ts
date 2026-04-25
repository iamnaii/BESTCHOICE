import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ShopUploadController, UploadKind } from './shop-upload.controller';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const mockStorageService = {
  getSignedUploadUrl: jest.fn().mockResolvedValue({
    url: 'https://storage.example.com/signed-url',
    method: 'PUT',
  }),
  getPublicUrl: jest.fn((key: string) => `https://cdn.example.com/${key}`),
};

describe('ShopUploadController', () => {
  let controller: ShopUploadController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopUploadController],
      providers: [{ provide: StorageService, useValue: mockStorageService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ShopUploadController>(ShopUploadController);
    jest.clearAllMocks();
    mockStorageService.getSignedUploadUrl.mockResolvedValue({
      url: 'https://storage.example.com/signed-url',
      method: 'PUT',
    });
    mockStorageService.getPublicUrl.mockImplementation(
      (key: string) => `https://cdn.example.com/${key}`,
    );
  });

  describe('LETTER_PDF with application/pdf content type', () => {
    it('returns a key under letters/ prefix with .pdf extension', async () => {
      const result = await controller.presign({
        kind: UploadKind.LETTER_PDF,
        contentType: 'application/pdf',
      });
      expect(result.key).toMatch(/^letters\/letter_pdf\/.+\.pdf$/);
      expect(result.publicUrl).toContain('letters/letter_pdf/');
    });
  });

  describe('LETTER_EVIDENCE with image/jpeg content type', () => {
    it('returns a key under letters/ prefix with .jpg extension', async () => {
      const result = await controller.presign({
        kind: UploadKind.LETTER_EVIDENCE,
        contentType: 'image/jpeg',
      });
      expect(result.key).toMatch(/^letters\/letter_evidence\/.+\.jpg$/);
    });
  });

  describe('LETTER_SIGNATURE with image/png content type', () => {
    it('returns a key under letters/ prefix with .png extension', async () => {
      const result = await controller.presign({
        kind: UploadKind.LETTER_SIGNATURE,
        contentType: 'image/png',
      });
      expect(result.key).toMatch(/^letters\/letter_signature\/.+\.png$/);
    });
  });

  describe('LETTER_LETTERHEAD with image/png content type', () => {
    it('returns a key under letters/ prefix with .png extension', async () => {
      const result = await controller.presign({
        kind: UploadKind.LETTER_LETTERHEAD,
        contentType: 'image/png',
      });
      expect(result.key).toMatch(/^letters\/letter_letterhead\/.+\.png$/);
    });
  });

  describe('non-letter kind (regression: BANK_SLIP)', () => {
    it('still routes to shop/ prefix', async () => {
      const result = await controller.presign({
        kind: UploadKind.BANK_SLIP,
        contentType: 'image/jpeg',
      });
      expect(result.key).toMatch(/^shop\/bank_slip\/.+\.jpg$/);
    });
  });

  describe('non-letter kind with PNG (regression: TRADE_IN_PHOTO)', () => {
    it('still routes to shop/ prefix with .png extension', async () => {
      const result = await controller.presign({
        kind: UploadKind.TRADE_IN_PHOTO,
        contentType: 'image/png',
      });
      expect(result.key).toMatch(/^shop\/trade_in_photo\/.+\.png$/);
    });
  });

  describe('MIME whitelist enforcement', () => {
    it('rejects LETTER_PDF with non-PDF content type', async () => {
      await expect(
        controller.presign({
          kind: UploadKind.LETTER_PDF,
          contentType: 'image/jpeg',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects LETTER_EVIDENCE with video/mp4', async () => {
      await expect(
        controller.presign({
          kind: UploadKind.LETTER_EVIDENCE,
          contentType: 'video/mp4',
        }),
      ).rejects.toThrow(/ไม่รองรับสำหรับประเภท/);
    });

    it('accepts LETTER_EVIDENCE with application/pdf', async () => {
      const result = await controller.presign({
        kind: UploadKind.LETTER_EVIDENCE,
        contentType: 'application/pdf',
      });
      expect(result.key).toMatch(/^letters\/letter_evidence\/.+\.pdf$/);
    });

    it('rejects LETTER_SIGNATURE with application/pdf', async () => {
      await expect(
        controller.presign({
          kind: UploadKind.LETTER_SIGNATURE,
          contentType: 'application/pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
