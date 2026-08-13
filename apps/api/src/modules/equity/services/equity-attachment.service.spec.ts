import { BadRequestException, ConflictException } from '@nestjs/common';
import { EquityAttachmentService } from './equity-attachment.service';

const pdfBuffer = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(20)]);
const fakePngNamedPdf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
const file = (buf: Buffer, mimetype = 'application/pdf'): Express.Multer.File =>
  ({ buffer: buf, mimetype, originalname: 'มติ.pdf', size: buf.length }) as Express.Multer.File;

describe('EquityAttachmentService', () => {
  const prisma = {
    equityDocument: { findFirst: jest.fn() },
    equityAttachment: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  };
  const storage = { upload: jest.fn(), delete: jest.fn(), getSignedDownloadUrl: jest.fn() };
  const service = new EquityAttachmentService(prisma as never, storage as never);

  beforeEach(() => jest.clearAllMocks());

  it('อัพโหลดสำเร็จเมื่อ DRAFT + magic bytes ตรง', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'DRAFT' });
    prisma.equityAttachment.create.mockResolvedValue({ id: 'att-1' });
    await service.upload('doc-1', file(pdfBuffer), 'user-1');
    expect(storage.upload).toHaveBeenCalled();
    expect(prisma.equityAttachment.create).toHaveBeenCalled();
  });

  it('ปฏิเสธไฟล์ magic bytes ไม่ตรง mimetype (PNG ปลอมเป็น PDF)', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'DRAFT' });
    await expect(service.upload('doc-1', file(fakePngNamedPdf), 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('ปฏิเสธเมื่อเอกสาร POSTED แล้ว', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'POSTED' });
    await expect(service.upload('doc-1', file(pdfBuffer), 'user-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('ลบไฟล์ได้เฉพาะ DRAFT/READY', async () => {
    prisma.equityDocument.findFirst.mockResolvedValue({ id: 'doc-1', status: 'POSTED' });
    prisma.equityAttachment.findFirst.mockResolvedValue({
      id: 'att-1',
      s3Key: 'k',
      documentId: 'doc-1',
    });
    await expect(service.remove('doc-1', 'att-1', 'user-1')).rejects.toThrow(ConflictException);
  });
});
