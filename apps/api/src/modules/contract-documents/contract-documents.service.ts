import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ContractDocumentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadContractDocumentDto } from './dto/contract-document.dto';

const VALID_DOCUMENT_TYPES = [
  'SIGNED_CONTRACT',
  'ID_CARD_COPY',
  'KYC',
  'FACEBOOK_PROFILE',
  'FACEBOOK_POST',
  'LINE_PROFILE',
  'DEVICE_RECEIPT_PHOTO',
  'BANK_STATEMENT',
  'OTHER',
];

@Injectable()
export class ContractDocumentsService {
  constructor(private prisma: PrismaService) {}

  async findByContract(contractId: string) {
    // Verify contract exists and is not soft-deleted
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    return this.prisma.contractDocument.findMany({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async upload(contractId: string, dto: UploadContractDocumentDto, userId: string) {
    // Verify contract exists and is not soft-deleted
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    if (!VALID_DOCUMENT_TYPES.includes(dto.documentType)) {
      throw new BadRequestException(`ประเภทเอกสารไม่ถูกต้อง: ${dto.documentType}`);
    }

    return this.prisma.contractDocument.create({
      data: {
        contractId,
        documentType: dto.documentType as ContractDocumentType,
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        fileSize: dto.fileSize,
        notes: dto.notes,
        uploadedById: userId,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async remove(contractId: string, docId: string) {
    const doc = await this.prisma.contractDocument.findFirst({
      where: { id: docId, contractId },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');

    return this.prisma.contractDocument.delete({ where: { id: docId } });
  }
}
