import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/document.dto';
import { ContractTemplateService } from './services/contract-template.service';
import { DocumentRenderingService } from './services/document-rendering.service';
import { DocumentPersistenceService } from './services/document-persistence.service';
import { ContractSignatureService } from './services/contract-signature.service';

/**
 * DocumentsService — facade over the four sub-services that resulted from the
 * Template/Signature/Rendering/Persistence decomposition. The 4-arg constructor
 * and all 20 public method signatures are preserved byte-identically; the
 * sub-services are constructed INTERNALLY from the four injected leaf deps, so
 * the module, the two controllers (documents.controller + line-oa/liff-api.controller),
 * and the three specs (which mock the four leaf deps) need no changes.
 *
 * Construction order: Template (prisma) → Rendering (prisma, storage, settings) →
 * Persistence (…, template, rendering) → Signature (prisma, () => persistence).
 * The fire-and-forget signContract → ensureSignedContractDocument hook resolves
 * Persistence lazily through the arrow, so it stays non-awaited / non-tx.
 */
@Injectable()
export class DocumentsService {
  private readonly templateService: ContractTemplateService;
  private readonly renderingService: DocumentRenderingService;
  private readonly persistenceService: DocumentPersistenceService;
  private readonly signatureService: ContractSignatureService;

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private notificationsService: NotificationsService,
    private settingsService: SettingsService,
  ) {
    this.templateService = new ContractTemplateService(this.prisma);
    this.renderingService = new DocumentRenderingService(this.prisma, this.storageService, this.settingsService);
    this.persistenceService = new DocumentPersistenceService(
      this.prisma,
      this.storageService,
      this.notificationsService,
      this.templateService,
      this.renderingService,
    );
    this.signatureService = new ContractSignatureService(this.prisma, () => this.persistenceService);
  }

  // ─── Contract Templates (ContractTemplateService) ────
  findAllTemplates(type?: string, page = 1, limit = 50) {
    return this.templateService.findAllTemplates(type, page, limit);
  }

  findOneTemplate(id: string) {
    return this.templateService.findOneTemplate(id);
  }

  createTemplate(dto: CreateTemplateDto) {
    return this.templateService.createTemplate(dto);
  }

  updateTemplate(id: string, dto: UpdateTemplateDto) {
    return this.templateService.updateTemplate(id, dto);
  }

  deleteTemplate(id: string) {
    return this.templateService.deleteTemplate(id);
  }

  // ─── E-Signature (ContractSignatureService) ──────────
  signContract(
    contractId: string,
    signatureImage: string,
    signerType: string,
    req: { ip?: string; userAgent?: string },
    options?: {
      signatureSvg?: string;
      signerName?: string;
      screenSize?: string;
      gpsLatitude?: number;
      gpsLongitude?: number;
      staffUserId?: string;
    },
  ) {
    return this.signatureService.signContract(contractId, signatureImage, signerType, req, options);
  }

  deleteSignature(contractId: string, signerType: string) {
    return this.signatureService.deleteSignature(contractId, signerType);
  }

  getSignatures(contractId: string, page = 1, limit = 50) {
    return this.signatureService.getSignatures(contractId, page, limit);
  }

  // ─── E-Document Generation / Persistence (DocumentPersistenceService) ────
  ensureSignedContractDocument(contractId: string, uploadedByUserId: string) {
    return this.persistenceService.ensureSignedContractDocument(contractId, uploadedByUserId);
  }

  generateDocument(contractId: string, createdById: string, documentType: string, templateId?: string) {
    return this.persistenceService.generateDocument(contractId, createdById, documentType, templateId);
  }

  generatePdfBuffer(contractId: string, userId: string): Promise<Buffer> {
    return this.persistenceService.generatePdfBuffer(contractId, userId);
  }

  getContractNumber(contractId: string): Promise<string> {
    return this.persistenceService.getContractNumber(contractId);
  }

  getDocuments(contractId: string, page = 1, limit = 50) {
    return this.persistenceService.getDocuments(contractId, page, limit);
  }

  getDocument(id: string) {
    return this.persistenceService.getDocument(id);
  }

  generatePdpaDocument(contractId: string, createdById: string) {
    return this.persistenceService.generatePdpaDocument(contractId, createdById);
  }

  generateSignedDocuments(contractId: string, createdById: string) {
    return this.persistenceService.generateSignedDocuments(contractId, createdById);
  }

  regenerateSignedContractPdfs(createdById: string, limit = 500) {
    return this.persistenceService.regenerateSignedContractPdfs(createdById, limit);
  }

  previewContract(contractId: string, templateId?: string) {
    return this.persistenceService.previewContract(contractId, templateId);
  }

  getDocumentStream(id: string): Promise<{ stream: import('stream').Readable; filename: string; contentType: string }> {
    return this.persistenceService.getDocumentStream(id);
  }

  getDocumentSignedUrl(id: string): Promise<{ url: string; expiresIn: number }> {
    return this.persistenceService.getDocumentSignedUrl(id);
  }
}
