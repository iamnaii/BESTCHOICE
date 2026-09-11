import { randomUUID, createHash } from 'crypto';
import { DocumentPersistenceService } from '../src/modules/contracts/services/document-persistence.service';
import { NotificationDispatchService } from '../src/modules/notifications/services/notification-dispatch.service';
import { NotificationTransportService } from '../src/modules/notifications/services/notification-transport.service';
import { ComplianceService } from '../src/modules/notifications/compliance.service';
import { NotificationTemplateService } from '../src/modules/notifications/notification-template.service';
import { ContractQueryService } from '../src/modules/contracts/services/contract-query.service';
import { Readable } from 'stream';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { DocumentsController } from '../src/modules/contracts/documents.controller';
import { ContractDocumentsController } from '../src/modules/contracts/contract-documents.controller';
import { DocumentsService } from '../src/modules/contracts/documents.service';
import { ContractDocumentsService } from '../src/modules/contracts/contract-documents.service';
import { ContractFileAccessGuard } from '../src/modules/contracts/contract-file-access.guard';
import { DocumentRenderingService } from '../src/modules/contracts/services/document-rendering.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { OcrService } from '../src/modules/ocr/ocr.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { EntityScopeInterceptor } from '../src/interceptors/entity-scope.interceptor';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Run tools/test-chat-credit.sh with its disposable database');

describe('Staff sales documents on isolated PostgreSQL', () => {
  const db = new PrismaService();
  const prefix = `DOC-TEST-${randomUUID()}`;
  const files = new Map<string, Buffer>();
  const storage = { configured: true,
    upload: jest.fn(async (key: string, body: Buffer) => { files.set(key, body); return key; }),
    getStream: jest.fn(async (key: string) => { if (!files.has(key)) throw new Error('Test asset missing'); return Readable.from([files.get(key)!]); }),
    getSignedDownloadUrl: jest.fn(async () => 'https://never-open.example.invalid/test'),
  };
  const notifications = { send: jest.fn() };
  let app: INestApplication, documents: DocumentsService;
  let branchA: string, branchB: string, userId: string, contractA: string, contractB: string, attachmentA: string, generatedA: string, generatedB: string;
  let actor: { id: string; role: string; branchId: string | null; accessibleCompanies: string[]; primaryCompany: string };
  const pdf = Buffer.from('%PDF-1.4\n%Synthetic document test\n%%EOF');
  const render = jest.spyOn(DocumentRenderingService.prototype, 'htmlToPdf');
  const read = (path: string) => request(app.getHttpServer()).get(path).query({ company: 'shop' });
  beforeAll(async () => {
    await db.$connect();
    branchA = (await db.branch.create({ data: { name: `${prefix}-A` } })).id;
    branchB = (await db.branch.create({ data: { name: `${prefix}-B` } })).id;
    userId = (await db.user.create({ data: { name: prefix, email: `${prefix}@example.invalid`, password: 'unused', role: 'OWNER', branchId: branchA } })).id;
    const customer = await db.customer.create({ data: { name: prefix, phone: '0800000000', nationalId: `799${Date.now().toString().slice(-10)}`, birthDate: new Date('1990-01-01'), lineIdFinance: `TEST-NOT-SENT-${prefix}` } });
    const make = async (branchId: string, name: string) => {
      const product = await db.product.create({ data: { name, brand: 'TEST', model: 'TEST', category: 'PHONE_NEW', branchId, costPrice: '6000', cashPrice: '10000' } });
      const consent = await db.pDPAConsent.create({ data: { customerId: customer.id, consentVersion: 'test', privacyNoticeText: 'SYNTHETIC', status: 'GRANTED', grantedAt: new Date() } });
      return db.contract.create({ data: { contractNumber: name, planType: 'STORE_DIRECT', branchId, customerId: customer.id, productId: product.id, salespersonId: userId, pdpaConsentId: consent.id,
        sellingPrice: '10000', downPayment: '2000', interestRate: '0.01', totalMonths: 6, interestTotal: '480', financedAmount: '8000', monthlyPayment: '1413.33',
        signatures: { create: ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'].map(signerType => ({ signerType: signerType as 'CUSTOMER' | 'COMPANY' | 'WITNESS_1' | 'WITNESS_2', signatureImage: 'data:image/png;base64,dGVzdA==' })) } } });
    };
    contractA = (await make(branchA, `${prefix}-A`)).id;
    contractB = (await make(branchB, `${prefix}-B`)).id;
    attachmentA = (await db.contractDocument.create({ data: { contractId: contractA, documentType: 'DEVICE_PHOTO', fileName: 'attached.pdf', fileUrl: `data:application/pdf;base64,${pdf.toString('base64')}`, uploadedById: userId } })).id;
    const generated = async (contractId: string) => db.eDocument.create({ data: { contractId, documentType: 'CONTRACT', fileUrl: `${contractId}.pdf`, fileHash: 'test', createdById: userId } });
    generatedA = (await generated(contractA)).id; files.set(`${contractA}.pdf`, pdf);
    generatedB = (await generated(contractB)).id; files.set(`${contractB}.pdf`, pdf);
    const module = await Test.createTestingModule({ controllers: [ContractDocumentsController, DocumentsController], providers: [
      DocumentsService, ContractDocumentsService, ContractFileAccessGuard, RolesGuard,
      { provide: PrismaService, useValue: db }, { provide: StorageService, useValue: storage },
      { provide: NotificationsService, useValue: notifications }, { provide: SettingsService, useValue: { findAll: async () => [] } }, { provide: OcrService, useValue: {} },
    ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx: ExecutionContext) => { ctx.switchToHttp().getRequest().user = actor; return true; } }).compile();
    documents = module.get(DocumentsService);
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new EntityScopeInterceptor());
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => { actor = { id: userId, role: 'SALES', branchId: branchA, accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' }; render.mockResolvedValue(pdf); });
  afterAll(async () => { await app?.close(); await db.$disconnect(); render.mockRestore(); });

  it('keeps uploaded and generated document IDs in distinct routes', async () => {
    const uploads = await read(`/contracts/${contractA}/documents`).expect(200);
    const generated = await read(`/contracts/${contractA}/e-documents`).expect(200);
    expect(uploads.body.data.map((row: { id: string }) => row.id)).toContain(attachmentA);
    expect(generated.body.data.map((row: { id: string }) => row.id)).toContain(generatedA);
    expect(generated.body.data.map((row: { id: string }) => row.id)).not.toContain(attachmentA);
  });
  it.each(['SALES', 'BRANCH_MANAGER'])('rejects %s cross-branch reads and signature/file side effects', async role => {
    actor.role = role;
    for (const path of [`/contracts/${contractB}/documents`, `/contracts/${contractB}/documents/checklist`, `/contracts/${contractB}/e-documents`, `/contracts/${contractB}/preview`, `/contracts/${contractB}/signatures`, `/documents/${generatedB}/download`, `/documents/${generatedB}/signed-url`]) await read(path).expect(403);
    await request(app.getHttpServer()).post(`/contracts/${contractB}/documents`).send({}).expect(403);
    await request(app.getHttpServer()).post(`/contracts/${contractB}/sign`).send({}).expect(403);
    await request(app.getHttpServer()).post(`/contracts/${contractB}/generate-signed-documents`).send({}).expect(403);
    actor.branchId = null;
    await read(`/contracts/${contractA}/documents`).expect(403);
  });
  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('preserves %s cross-branch read permission', async role => {
    actor.role = role; actor.branchId = null;
    await read(`/contracts/${contractB}/e-documents`).expect(200);
  });
  it('rejects mismatched attachment IDs before logging a view', async () => {
    actor.role = 'OWNER';
    const before = await db.documentAuditLog.count({ where: { documentId: attachmentA } });
    await read(`/contracts/${contractB}/documents/${attachmentA}/content`).expect(404);
    await request(app.getHttpServer()).post(`/contracts/${contractB}/documents/${attachmentA}/view`).send({}).expect(404);
    expect(await db.documentAuditLog.count({ where: { documentId: attachmentA } })).toBe(before);
  });
  it('streams protected attachments and PDFs with exact fixture bytes', async () => {
    for (const path of [`/contracts/${contractA}/documents/${attachmentA}/content`, `/documents/${generatedA}/download`]) {
      const result = await read(path).expect(200).expect('Content-Type', /application\/pdf/);
      expect(result.body).toEqual(pdf);
    }
  });
  it('turns a late storage stream error into a retryable JSON response', async () => {
    storage.getStream.mockImplementationOnce(async () => new Readable({ read() { this.destroy(new Error('synthetic read failed')); } }));
    const response = await read(`/documents/${generatedA}/download`).expect(503).expect('Content-Type', /application\/json/);
    expect(response.body.message).toContain('ลองใหม่');
  });
  it('excludes deleted generated documents and rejects deleted contracts', async () => {
    const removed = await db.eDocument.create({ data: { contractId: contractA, documentType: 'CONTRACT', fileUrl: '<html>SYNTHETIC DELETED</html>', fileHash: 'test', createdById: userId, deletedAt: new Date() } });
    await read(`/documents/${removed.id}/download`).expect(404);
    expect((await read(`/contracts/${contractA}/e-documents`)).body.data.map((r: { id: string }) => r.id)).not.toContain(removed.id);
    await db.contract.update({ where: { id: contractB }, data: { deletedAt: new Date() } });
    actor.role = 'OWNER';
    await read(`/documents/${generatedB}/download`).expect(404);
    await db.contract.update({ where: { id: contractB }, data: { deletedAt: null } });
  });
  it('does not expose deleted attachment bytes through the contract aggregate', async () => {
    const removed = await db.contractDocument.create({ data: { contractId: contractA, documentType: 'OTHER', fileName: 'deleted.pdf', fileUrl: 'data:application/pdf;base64,REVMRVRFRA==', uploadedById: userId, deletedAt: new Date() } });
    const contract = await new ContractQueryService(db).findOne(contractA, { id: userId, role: 'OWNER', branchId: branchA });
    expect(contract.contractDocuments.map(row => row.id)).not.toContain(removed.id);
    await read(`/contracts/${contractA}/documents/${removed.id}/content`).expect(404);
  });
  it('stores real HTML fallback bytes and reports PDF unavailable', async () => {
    render.mockRejectedValue(new Error('synthetic renderer failure'));
    const result = await documents.generateSignedDocuments(contractA, userId);
    expect(result.contract?.pdfGenerated).toBe(false);
    expect(result.pdpa?.pdfGenerated).toBe(false);
    for (const doc of [result.contract!, result.pdpa!]) {
      expect(files.get(doc.fileUrl)?.toString()).toContain('<html');
      const downloaded = await read(`/documents/${doc.id}/download`).expect(200).expect('Content-Type', /text\/html/);
      expect(downloaded.text).toBe(files.get(doc.fileUrl)!.toString());
    }
    expect(await db.notificationLog.count({ where: { relatedId: contractA, subject: 'CONTRACT_DOCUMENTS_READY' } })).toBe(0);
  });
  it('repairs a missing signed attachment and enqueues one notification across concurrent retries', async () => {
    const results = await Promise.all([documents.generateSignedDocuments(contractA, userId), documents.generateSignedDocuments(contractA, userId)]);
    expect(results.every(r => r.contract?.pdfGenerated && r.pdpa?.pdfGenerated && !r.errors?.length)).toBe(true);
    expect(await db.contractDocument.count({ where: { contractId: contractA, documentType: 'SIGNED_CONTRACT', isLatest: true, deletedAt: null } })).toBe(1);
    const jobs = await db.notificationLog.findMany({ where: { relatedId: contractA, subject: 'CONTRACT_DOCUMENTS_READY' } });
    expect(jobs).toHaveLength(1); expect(jobs[0].status).toBe('DELAYED');
    expect(notifications.send).not.toHaveBeenCalled(); // Scheduler is deliberately absent from this harness.
  });
  it('serializes attachment versions and records the decoded size rather than client claims', async () => {
    const payload = { documentType: 'GUARDIAN_DOC', fileName: 'guardian.pdf', fileUrl: `data:application/pdf;base64,${pdf.toString('base64')}`, fileSize: 1, mimeType: 'text/html' };
    await Promise.all([request(app.getHttpServer()).post(`/contracts/${contractA}/documents`).send(payload).expect(201), request(app.getHttpServer()).post(`/contracts/${contractA}/documents`).send(payload).expect(201)]);
    const rows = await db.contractDocument.findMany({ where: { contractId: contractA, documentType: 'GUARDIAN_DOC' }, orderBy: { version: 'asc' } });
    expect(rows.map(row => row.version)).toEqual([1, 2]);
    expect(rows.filter(row => row.isLatest)).toHaveLength(1);
    expect(rows.every(row => row.fileSize === pdf.length && row.mimeType === 'application/pdf')).toBe(true);
    await request(app.getHttpServer()).post(`/contracts/${contractA}/documents`).send({ ...payload, fileUrl: 'data:text/html;base64,PHNjcmlwdD4=' }).expect(400);
  });
  it('rejects disguised HTML advertised as each supported binary type', async () => {
    const count = await db.contractDocument.count({ where: { contractId: contractA } });
    for (const mime of ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      await request(app.getHttpServer()).post(`/contracts/${contractA}/documents`).send({ documentType: 'OTHER', fileName: 'fake.pdf', fileUrl: `data:${mime};base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}` }).expect(400);
    }
    expect(await db.contractDocument.count({ where: { contractId: contractA } })).toBe(count);
  });
  it('rejects a paused render after delete/re-sign and removes superseded evidence', async () => {
    let started!: () => void, finish!: (buffer: Buffer) => void;
    const rendering = new Promise<void>(resolve => { started = resolve; });
    const paused = new Promise<Buffer>(resolve => { finish = resolve; });
    render.mockImplementationOnce(async () => { started(); return paused; });
    const oldBytes = Buffer.from('%PDF-1.4 OLD SIGNATURE SNAPSHOT');
    const oldHash = createHash('sha256').update(oldBytes).digest('hex');
    const generating = documents.generateSignedDocuments(contractA, userId);
    await rendering;
    await documents.deleteSignature(contractA, 'WITNESS_2');
    expect(await db.contractDocument.count({ where: { contractId: contractA, documentType: 'SIGNED_CONTRACT', isLatest: true, deletedAt: null } })).toBe(0);
    expect(await db.eDocument.count({ where: { contractId: contractA, documentType: 'CONTRACT', deletedAt: null } })).toBe(0);
    expect(await db.notificationLog.count({ where: { relatedId: contractA, subject: 'CONTRACT_DOCUMENTS_READY', status: 'DELAYED' } })).toBe(0);
    // Control the independent auto-save hook; retry below exercises actual persistence.
    const auto = jest.spyOn(DocumentPersistenceService.prototype, 'ensureSignedContractDocument').mockResolvedValueOnce(null);
    try {
      await documents.signContract(contractA, 'data:image/png;base64,bmV3', 'WITNESS_2', {}, { staffUserId: userId });
    } finally { auto.mockRestore(); finish(oldBytes); }
    const stale = await generating;
    expect(stale.errors?.join(' ')).toContain('เปลี่ยน');
    expect(await db.eDocument.count({ where: { contractId: contractA, fileHash: oldHash } })).toBe(0);
    const retry = await documents.generateSignedDocuments(contractA, userId);
    expect(retry.errors).toBeUndefined();
    expect(await db.contractDocument.count({ where: { contractId: contractA, documentType: 'SIGNED_CONTRACT', isLatest: true, deletedAt: null } })).toBe(1);
    expect(await db.notificationLog.count({ where: { relatedId: contractA, subject: 'CONTRACT_DOCUMENTS_READY', status: 'DELAYED' } })).toBe(1);
  });
  it('does not dispatch a notice cancelled after the worker fetched its batch', async () => {
    let checked!: () => void, proceed!: () => void;
    const checking = new Promise<void>(resolve => { checked = resolve; });
    const paused = new Promise<void>(resolve => { proceed = resolve; });
    const sendLine = jest.fn();
    const dispatch = new NotificationDispatchService({ sendLine } as unknown as NotificationTransportService, db,
      { canSend: async () => { checked(); await paused; return { allowed: true }; } } as unknown as ComplianceService,
      {} as NotificationTemplateService);
    const processing = dispatch.processRetryQueue();
    await checking;
    await documents.deleteSignature(contractA, 'WITNESS_2');
    proceed();
    await processing;
    expect(sendLine).not.toHaveBeenCalled();
    expect(await db.notificationLog.count({ where: { relatedId: contractA, subject: 'CONTRACT_DOCUMENTS_READY', status: { in: ['DELAYED', 'RETRY_PENDING', 'SENT'] } } })).toBe(0);
  });
  it('never revives cancellation when an already-dispatched transport fails', async () => {
    const job = await db.notificationLog.create({ data: { channel: 'LINE', channelKey: 'line-finance', recipient: 'TEST-NOT-SENT', subject: 'CONTRACT_DOCUMENTS_READY', message: 'SYNTHETIC', relatedId: contractB, status: 'DELAYED', nextRetryAt: new Date(0) } });
    const sendLine = jest.fn(async () => {
      await db.notificationLog.update({ where: { id: job.id }, data: { status: 'CANCELLED', nextRetryAt: null } });
      throw new Error('synthetic transport failure after cancellation');
    });
    const dispatch = new NotificationDispatchService({ sendLine } as unknown as NotificationTransportService, db,
      {} as ComplianceService, {} as NotificationTemplateService);
    await dispatch.processRetryQueue();
    expect(sendLine).toHaveBeenCalledTimes(1);
    const current = await db.notificationLog.findUniqueOrThrow({ where: { id: job.id } });
    expect(current.status).toBe('CANCELLED');
    expect(current.nextRetryAt).toBeNull();
  });
  it('records no EDocument when storage rejects the upload', async () => {
    const count = await db.eDocument.count({ where: { contractId: contractA } });
    storage.upload.mockRejectedValueOnce(new Error('synthetic storage unavailable'));
    await expect(documents.generateDocument(contractA, userId, 'CONTRACT')).rejects.toThrow();
    expect(await db.eDocument.count({ where: { contractId: contractA } })).toBe(count);
  });
});
