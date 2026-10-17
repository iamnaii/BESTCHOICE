import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  CustomerAttachmentList,
  CustomerAttachmentSourceKind,
  CUSTOMER_ATTACHMENT_SENSITIVE_KEYS,
} from '@installment/shared';
import { PartyDocumentSources } from '../../employee-access/access-party-document-source';
import {
  AccessPartySourceService,
  partyWriteExecution,
} from '../../employee-access/access-party-source.service';
import { procurementPreparation } from '../../employee-access/access-preparation-context';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { UploadDocumentDto } from '../dto/document.dto';
import { CUSTOMER_DOCUMENT_MAX_BYTES, validateCustomerDocument } from './customer-document-file';
const unavailable = () => new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสารนี้');
@Injectable()
export class CustomerDocumentsService {
  constructor(
    private readonly sources: AccessPartySourceService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}
  private proof() {
    return new PartyDocumentSources(this.sources);
  }
  async preauthorize(id: string, dto: UploadDocumentDto) {
    const proof = this.proof(),
      family = await proof.family(id);
    return proof.authorize(
      id,
      dto.sourceKind,
      dto.sourceId,
      proof.ctx!.scope.company,
      family,
      'upload',
    );
  }
  async upload(id: string, dto: UploadDocumentDto, file?: Express.Multer.File) {
    const preparation = procurementPreparation.getStore();
    if (!preparation || partyWriteExecution()) throw unavailable();
    if (!file) throw new BadRequestException('กรุณาแนบไฟล์จริง');
    await preparation.authorize!();
    const metadata = await validateCustomerDocument(file);
    if (!this.storage.configured)
      throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่าที่เก็บเอกสาร');
    const operationToken = randomUUID(),
      attachmentId = randomUUID(),
      storageKey = `customer-attachments/${randomUUID()}/${attachmentId}`;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    try {
      await this.storage.uploadOwned(storageKey, file.buffer, metadata.mimeType, operationToken);
      return await preparation.execute(async () => {
        const source = await this.preauthorize(id, dto),
          ctx = partyWriteExecution()!;
        await ctx.client.customerAttachment.create({
          data: {
            id: attachmentId,
            originCustomerId: id,
            sourceKind: dto.sourceKind,
            sourceId: dto.sourceId,
            accessCompanyCode: source.company,
            accessBranchId: source.branchId ?? null,
            storageKey,
            ...metadata,
            sha256,
            createdById: ctx.snapshot.userId,
          },
        });
        await this.evidence('CUSTOMER_DOCUMENT_CREATED', id, attachmentId);
        return { id, attachmentId };
      });
    } catch (error) {
      // Key is generated solely by this operation. Retries reuse staged bytes;
      // only terminal failure reaches cleanup, never a preexisting/shared key.
      await this.storage.deleteOwned(storageKey, operationToken);
      throw error;
    }
  }
  private async attachment(id: string, attachmentId: string, action: 'read' | 'remove') {
    const proof = this.proof(),
      family = await proof.family(id);
    await proof.assertCustomerRead(id, family);
    await proof.tx
      .$queryRaw`SELECT id FROM customer_attachments WHERE id=${attachmentId} FOR UPDATE`;
    const row = await proof.tx.customerAttachment.findFirst({
      where: { id: attachmentId, deletedAt: null, originCustomerId: { in: [...family] } },
    });
    if (!row) throw unavailable();
    await proof.authorize(
      row.originCustomerId,
      row.sourceKind as CustomerAttachmentSourceKind,
      row.sourceId,
      row.accessCompanyCode as 'SHOP' | 'FINANCE',
      family,
      action,
      row,
    );
    return row;
  }
  async remove(id: string, attachmentId: string) {
    const row = await this.attachment(id, attachmentId, 'remove'),
      ctx = partyWriteExecution()!;
    await ctx.client.customerAttachment.update({
      where: { id: row.id },
      data: { deletedAt: new Date() },
    });
    await this.evidence('CUSTOMER_DOCUMENT_REMOVED', id, row.id);
    return { id, attachmentId: row.id };
  }
  async content(id: string, attachmentId: string) {
    const row = await this.attachment(id, attachmentId, 'read');
    if (!this.storage.configured)
      throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่าที่เก็บเอกสาร');
    let bytes: Buffer;
    try {
      const stream = await this.storage.getStream(row.storageKey),
        chunks: Buffer[] = [];
      let size = 0;
      const readTimeout = setTimeout(() => stream.destroy(new Error('read timeout')), 10000);
      try {
        for await (const chunk of stream) {
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += value.length;
          if (size > CUSTOMER_DOCUMENT_MAX_BYTES || size > row.fileSize) throw new Error('size');
          chunks.push(value);
        }
      } finally {
        clearTimeout(readTimeout);
        stream.destroy();
      }
      bytes = Buffer.concat(chunks);
      if (
        bytes.length !== row.fileSize ||
        createHash('sha256').update(bytes).digest('hex') !== row.sha256
      )
        throw new Error('integrity');
    } catch {
      throw new ServiceUnavailableException('ไม่สามารถอ่านเอกสารที่ตรวจสอบได้');
    }
    await this.evidence('CUSTOMER_DOCUMENT_READ_AUTHORIZED', id, row.id);
    // Nest emits the returned StreamableFile only when the outer owned executor
    // has committed. This evidence proves authorized release, not client delivery.
    return new StreamableFile(bytes, {
      type: row.mimeType,
      length: bytes.length,
      disposition: `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
    });
  }
  async list(id: string): Promise<CustomerAttachmentList> {
    const proof = this.proof(),
      family = await proof.family(id),
      ctx = proof.ctx!;
    // Root identity visibility is independent from any historic attachment.
    await proof.assertCustomerRead(id, family);
    const uploadSources = await proof.candidates(id, family);
    const items: NonNullable<CustomerAttachmentList['items']> = [];
    let hidden = false,
      visible = false;
    for (const originId of family) {
      const origin = await ctx.client.customer.findUniqueOrThrow({ where: { id: originId } });
      let legacyAllowed = false;
      try {
        if (origin.accessCompanyCode) {
          await proof.authorize(
            originId,
            'CUSTOMER_ORIGIN',
            originId,
            origin.accessCompanyCode as 'SHOP' | 'FINANCE',
            family,
            'read',
          );
          legacyAllowed = true;
        } else if (originId === id) {
          const sources = await this.sources.customer(ctx.client, id, true, false, true);
          legacyAllowed = sources.some(
            (source) =>
              source.company === ctx.scope.company &&
              (
                ['customers.read', 'documents.read', ...CUSTOMER_ATTACHMENT_SENSITIVE_KEYS] as const
              ).every((key) => this.sources.allows(ctx.snapshot, key, source)),
          );
        }
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
      visible ||= legacyAllowed;
      if (!legacyAllowed) hidden = true;
      else
        for (const reference of origin.documents)
          items.push({
            kind: 'legacy',
            originCustomerId: originId,
            reference,
            availability: 'unsupported',
          });
    }
    await ctx.client
      .$queryRaw`SELECT id FROM customer_attachments WHERE origin_customer_id = ANY(${[...family]}::text[]) ORDER BY id FOR SHARE`;
    for (const row of await ctx.client.customerAttachment.findMany({
      where: { originCustomerId: { in: [...family] }, deletedAt: null },
      orderBy: { id: 'asc' },
    })) {
      try {
        await proof.authorize(
          row.originCustomerId,
          row.sourceKind as CustomerAttachmentSourceKind,
          row.sourceId,
          row.accessCompanyCode as 'SHOP' | 'FINANCE',
          family,
          'read',
          row,
        );
        let canRemove = true;
        try {
          await proof.authorize(
            row.originCustomerId,
            row.sourceKind as CustomerAttachmentSourceKind,
            row.sourceId,
            row.accessCompanyCode as 'SHOP' | 'FINANCE',
            family,
            'remove',
            row,
          );
        } catch (error) {
          if (!(error instanceof ForbiddenException)) throw error;
          canRemove = false;
        }
        items.push({
          kind: 'verified',
          id: row.id,
          originCustomerId: row.originCustomerId,
          fileName: row.fileName,
          mimeType: row.mimeType,
          fileSize: row.fileSize,
          createdAt: row.createdAt.toISOString(),
          canRemove,
        });
        visible = true;
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        hidden = true;
      }
    }
    return {
      availability: visible ? (hidden ? 'partial' : 'available') : 'unavailable',
      items: visible ? items : null,
      uploadSources,
    };
  }
  private async evidence(action: string, id: string, attachmentId: string) {
    const ctx = partyWriteExecution()!;
    await this.audit.log(
      {
        userId: ctx.snapshot.userId,
        action,
        entity: 'customer',
        entityId: id,
        newValue: { attachmentId },
      },
      ctx.client,
    );
  }
}
