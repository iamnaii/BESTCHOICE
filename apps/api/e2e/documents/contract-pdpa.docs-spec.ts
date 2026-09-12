import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import { DOCUMENT_STYLE } from '@installment/shared';
import { bodyBuffer, DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { recordScenario, saveArtifact, sha256, ScenarioRecord } from './support/artifacts';
import { foldThai, isA4, pageContaining, parsePdf, ParsedPdf, sizesOfText, textSizes } from './support/pdf';

/**
 * DOC-00 reference flow (issue #1559): synthetic user → real POST /auth/login →
 * guarded contract/PDPA routes → Chromium PDF → private local storage → download.
 *
 * Nothing on the request path is stubbed. Outbound LINE/SMS/e-mail are recorded
 * by the harness and asserted to stay empty.
 */
const DOMAIN = 'contract-pdpa';
const GUARDS = ['CsrfGuard', 'ThrottlerGuard', 'JwtAuthGuard→JwtStrategy(DB user)', 'JwtAudienceGuard', 'RolesGuard', 'ContractFileAccessGuard', 'EntityScopeInterceptor', 'AuditInterceptor'];
const SIMULATED = [
  'LINE/SMS/e-mail transports recorded by the harness, never sent',
  'private local directory instead of GCS/S3 (signed URLs answer 501)',
  'company, branches, users, customer and contracts are synthetic Prisma rows with test markers',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['CONTRACT', 'PDPA_CONSENT'], guards: GUARDS, renderer: 'chromium', source: 'api', status: 'PASS', simulated: SIMULATED, ...record,
});

type GeneratedDoc = { id: string; fileUrl: string; fileHash: string; documentType: string; pdfGenerated: boolean };
const CONTRACT_TITLE = 'สัญญาเช่าซื้อโทรศัพท์มือถือ';
const CLOSING = 'จึงลงลายมือชื่อไว้เป็นสำคัญ';

describe('DOC-00 reference flow — contract + PDPA through the real API', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let owner: Session, salesA: Session, salesB: Session, accountant: Session;
  const generated: { contract?: GeneratedDoc; pdpa?: GeneratedDoc } = {};
  const templates: string[] = [];
  const stored = (doc: GeneratedDoc) => readFileSync(join(h.storage.location, doc.fileUrl));
  const summary = (pdf: ParsedPdf) => ({ pageCount: pdf.pageCount, pages: pdf.pages.map((p) => ({ index: p.index, widthPt: +p.widthPt.toFixed(2), heightPt: +p.heightPt.toFixed(2), lines: p.lines.length })), fonts: pdf.fonts, sizes: textSizes(pdf) });

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    [owner, salesA, salesB, accountant] = await Promise.all([world.users.owner, world.users.salesA, world.users.salesB, world.users.accountant].map((u) => h.login(u.email, u.password)));
  }, 180000);

  afterAll(async () => {
    for (const id of templates) await h.prisma.contractTemplate.updateMany({ where: { id }, data: { isActive: false } });
    await h?.close();
  });

  it('authenticates through POST /auth/login with bcrypt credentials and real company grants', async () => {
    expect(owner.user.role).toBe('OWNER');
    expect([...owner.user.accessibleCompanies].sort()).toEqual(['FINANCE', 'SHOP']);
    expect(salesA.user.accessibleCompanies).toEqual(['SHOP']);
    expect(salesA.user.branchId).toBe(world.branches.a.id);
    await h.client({ session: null }).post('/auth/login', { email: world.users.owner.email, password: 'wrong-password-1' }).expect(401);
    const me = await h.client({ session: salesA }).get('/auth/me').expect(200);
    expect(me.body.data.id).toBe(world.users.salesA.id);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/login`, title: 'Real login issues JWT with resolved company grants', routes: ['POST /api/auth/login', 'GET /api/auth/me'], renderer: 'none', artifacts: [], notes: 'bcrypt compare + lockout counters on the real AuthService' }));
  });

  it('rejects unauthenticated, forged and expired tokens on every document route without leaking bytes', async () => {
    const a = world.contracts.a;
    const forged = h.client({ token: sign({ sub: owner.user.id, role: 'OWNER', aud: 'admin' }, 'not-the-runner-secret') });
    const expired = h.client({ token: sign({ sub: owner.user.id, role: 'OWNER', aud: 'admin' }, process.env.JWT_SECRET!, { expiresIn: -30 }) });
    const anonymous = h.client({ session: null });
    for (const client of [anonymous, forged, expired]) {
      for (const path of [`/contracts/${a.id}/preview`, `/contracts/${a.id}/e-documents`, `/contracts/${a.id}/download-pdf`, '/contract-templates']) {
        const response = await client.get(path).expect(401);
        expect(response.headers['content-type']).toMatch(/json/);
      }
      await client.post(`/contracts/${a.id}/generate-signed-documents`).expect(401);
    }
    expect(await h.prisma.eDocument.count({ where: { contractId: a.id } })).toBe(0);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/unauthenticated`, title: 'No token / wrong secret / expired token → 401 JSON, no documents created', routes: ['GET /api/contracts/:id/preview', 'GET /api/contracts/:id/e-documents', 'GET /api/contracts/:id/download-pdf', 'POST /api/contracts/:id/generate-signed-documents'], renderer: 'none', artifacts: [] }));
  });

  it('previews the contract HTML through the shared A4 wrapper with real placeholders', async () => {
    const a = world.contracts.a;
    const response = await h.client({ session: salesA }).get(`/contracts/${a.id}/preview`).expect(200);
    const html: string = response.body.data.html;
    expect(html).toContain(a.contractNumber);
    expect(html).toContain(world.customer.name);
    expect(html).toContain(CONTRACT_TITLE);
    expect(html).toContain(`font-size: ${DOCUMENT_STYLE.bodyPt}pt`);
    expect(html).toContain(`font-size: ${DOCUMENT_STYLE.headingPt}pt`);
    expect(html).toContain(`'${DOCUMENT_STYLE.fontFamily}'`);
    expect(html).toContain('size: A4');
    const artifact = saveArtifact(DOMAIN, 'contract-preview-default.html', html);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/preview-html`, title: 'Preview HTML uses DOCUMENT_STYLE typography + A4 page rules', documents: ['CONTRACT'], routes: ['GET /api/contracts/:id/preview'], renderer: 'html', artifacts: [artifact.relativePath] }));
  });

  it('generates contract + PDPA PDFs with Chromium and stores bytes whose sha256 equals the persisted hash', async () => {
    const a = world.contracts.a;
    const response = await h.client({ session: salesA }).post(`/contracts/${a.id}/generate-signed-documents`).expect(201);
    const { contract, pdpa, errors } = response.body.data as { contract: GeneratedDoc; pdpa: GeneratedDoc; errors?: string[] };
    expect(errors).toBeUndefined();
    expect(contract.pdfGenerated).toBe(true);
    expect(pdpa.pdfGenerated).toBe(true);
    for (const doc of [contract, pdpa]) {
      expect(doc.fileUrl.endsWith('.pdf')).toBe(true);
      expect(existsSync(join(h.storage.location, doc.fileUrl))).toBe(true);
      const bytes = stored(doc);
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(sha256(bytes)).toBe(doc.fileHash);
    }
    generated.contract = contract;
    generated.pdpa = pdpa;
    const rows = await h.prisma.eDocument.findMany({ where: { contractId: a.id, deletedAt: null } });
    expect(rows.map((row) => row.documentType).sort()).toEqual(['CONTRACT', 'PDPA_CONSENT']);
    expect(await h.prisma.contractDocument.count({ where: { contractId: a.id, documentType: 'SIGNED_CONTRACT', isLatest: true, deletedAt: null } })).toBe(1);
    const jobs = await h.prisma.notificationLog.findMany({ where: { relatedId: a.id, subject: 'CONTRACT_DOCUMENTS_READY' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('DELAYED');
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/generate-signed`, title: 'Signed contract + PDPA rendered by Chromium, persisted with matching sha256, notification queued not sent', routes: ['POST /api/contracts/:id/generate-signed-documents'], artifacts: [], notes: `storage=${h.storage.backend} keys=${contract.fileUrl}, ${pdpa.fileUrl}` }));
  });

  it('downloads both documents with the exact stored bytes, filename and private cache headers', async () => {
    const artifacts: string[] = [];
    for (const [kind, doc] of Object.entries(generated) as Array<[string, GeneratedDoc]>) {
      const response = await h.client({ session: salesA }).get(`/documents/${doc.id}/download`).expect(200).expect('Content-Type', /application\/pdf/);
      const bytes = bodyBuffer(response);
      expect(sha256(bytes)).toBe(doc.fileHash);
      expect(bytes.equals(stored(doc))).toBe(true);
      expect(response.headers['content-disposition']).toContain(encodeURIComponent(doc.fileUrl.split('/').pop()!));
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      artifacts.push(saveArtifact(DOMAIN, `${kind}-default.pdf`, bytes).relativePath);
      const meta = await h.client({ session: salesA }).get(`/documents/${doc.id}`).expect(200);
      expect(meta.body.data.fileHash).toBe(doc.fileHash);
    }
    const listing = await h.client({ session: salesA }).get(`/contracts/${world.contracts.a.id}/e-documents`).expect(200);
    expect(listing.body.data.data.map((row: { id: string }) => row.id).sort()).toEqual([generated.contract!.id, generated.pdpa!.id].sort());
    const onDemand = await h.client({ session: salesA }).get(`/contracts/${world.contracts.a.id}/download-pdf`).expect(200).expect('Content-Type', /application\/pdf/);
    expect(bodyBuffer(onDemand).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await h.prisma.eDocument.count({ where: { contractId: world.contracts.a.id, deletedAt: null } })).toBe(2);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/download-bytes`, title: 'Protected download streams the stored bytes (hash equal), on-demand PDF renders without persisting', routes: ['GET /api/documents/:id/download', 'GET /api/documents/:id', 'GET /api/contracts/:id/e-documents', 'GET /api/contracts/:id/download-pdf'], artifacts }));
  });

  it('renders A4 pages in TH Sarabun PSK at 16/18/12 pt and keeps the closing statement with the signature table', async () => {
    const pdf = await parsePdf(stored(generated.contract!));
    expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
    expect(pdf.pages.every(isA4)).toBe(true);
    expect(pdf.fonts.length).toBeGreaterThan(0);
    expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    expect(pdf.fonts).toEqual(expect.arrayContaining([`${DOCUMENT_STYLE.pdfFontFamily}-Regular`, `${DOCUMENT_STYLE.pdfFontFamily}-Bold`]));
    expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
    expect(sizesOfText(pdf, CONTRACT_TITLE)).toEqual([DOCUMENT_STYLE.headingPt]);
    expect(sizesOfText(pdf, `หน้าที่ 1 / ${pdf.pageCount}`)).toEqual([DOCUMENT_STYLE.footerPt]);
    for (const page of pdf.pages) expect(foldThai(page.text)).toContain(foldThai(`สัญญาเช่าซื้อเลขที่ ${world.contracts.a.contractNumber}`));
    const closingPage = pageContaining(pdf, CLOSING);
    const signaturePage = pageContaining(pdf, `( ${world.customer.name} )`);
    expect(closingPage).toBe(pdf.pageCount);
    expect(signaturePage).toBe(closingPage);
    const artifact = saveArtifact(DOMAIN, 'contract-default.pdf.json', JSON.stringify({ ...summary(pdf), anchors: { title: 1, closingPage, signaturePage } }, null, 2));
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/contract-layout`, title: 'Contract PDF: A4, THSarabunPSK only, 16/18/12 pt, footer on every page, closing + signatures together', documents: ['CONTRACT'], routes: ['GET /api/documents/:id/download'], artifacts: ['contract-pdpa/contract-default.pdf', artifact.relativePath], unverified: ['paper output and margins on a physical printer (DOC-12)'], notes: 'Chromium page footer is fixed at 16px (=12pt) in DocumentRenderingService.htmlToPdf regardless of settings.fontSize.footer' }));
  });

  it('renders the PDPA consent on A4 with the consent statement and signature on the same page', async () => {
    const pdf = await parsePdf(stored(generated.pdpa!));
    expect(pdf.pages.every(isA4)).toBe(true);
    expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    expect(textSizes(pdf)[0].size).toBe(DOCUMENT_STYLE.bodyPt);
    expect(pageContaining(pdf, world.contracts.a.contractNumber)).toBe(1);
    const consentPage = pageContaining(pdf, 'ข้าพเจ้ายินยอม');
    const signaturePage = pageContaining(pdf, 'ผู้ให้ความยินยอม');
    expect(consentPage).toBeGreaterThan(0);
    expect(signaturePage).toBe(consentPage);
    expect(pageContaining(pdf, `(${world.customer.name})`)).toBe(consentPage);
    const artifact = saveArtifact(DOMAIN, 'pdpa-default.pdf.json', JSON.stringify({ ...summary(pdf), anchors: { consentPage, signaturePage } }, null, 2));
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/pdpa-layout`, title: 'PDPA PDF: A4, THSarabunPSK, consent statement and signature on one page', documents: ['PDPA_CONSENT'], routes: ['GET /api/documents/:id/download'], artifacts: ['contract-pdpa/pdpa-default.pdf', artifact.relativePath] }));
  });

  it('enforces branch, role and company scope with real guards; denials carry JSON, never bytes', async () => {
    const b = world.contracts.b;
    const ownerGenerated = await h.client({ session: owner }).post(`/contracts/${b.id}/generate-signed-documents`).expect(201);
    const docB: GeneratedDoc = ownerGenerated.body.data.contract;
    const foreign = h.client({ session: salesA });
    for (const path of [`/contracts/${b.id}/preview`, `/contracts/${b.id}/e-documents`, `/contracts/${b.id}/download-pdf`, `/documents/${docB.id}/download`, `/documents/${docB.id}`, `/documents/${docB.id}/signed-url`]) {
      const response = await foreign.get(path).expect(403);
      expect(response.headers['content-type']).toMatch(/json/);
    }
    await foreign.post(`/contracts/${b.id}/generate-signed-documents`).expect(403);
    await foreign.post(`/contracts/${b.id}/generate-pdpa-document`).expect(403);
    await h.client({ session: salesB }).get(`/documents/${generated.contract!.id}/download`).expect(403);
    const crossBranch = h.client({ session: accountant });
    expect(sha256(bodyBuffer(await crossBranch.get(`/documents/${docB.id}/download`).expect(200)))).toBe(docB.fileHash);
    await crossBranch.post(`/contracts/${b.id}/generate-signed-documents`).expect(403);
    await crossBranch.post('/contract-templates', { name: 'x', contentHtml: '<div>{contract_number}</div>' }).expect(403);
    await h.client({ session: salesA, company: 'FINANCE' }).get(`/contracts/${world.contracts.a.id}/e-documents`).expect(403);
    await h.client({ session: salesA, company: null }).get(`/contracts/${world.contracts.a.id}/e-documents`).expect(200);
    await foreign.get(`/documents/${randomUUID()}/download`).expect(404);
    await foreign.get(`/contracts/${randomUUID()}/preview`).expect(404);
    expect(await h.prisma.eDocument.count({ where: { contractId: b.id, deletedAt: null } })).toBe(2);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/authorization`, title: 'SALES other branch 403, ACCOUNTANT reads cross-branch but cannot generate, company scope 403, unknown IDs 404', routes: ['GET /api/contracts/:id/preview', 'GET /api/documents/:id/download', 'GET /api/documents/:id/signed-url', 'POST /api/contracts/:id/generate-signed-documents', 'POST /api/contracts/:id/generate-pdpa-document', 'POST /api/contract-templates'], artifacts: [] }));
  });

  it('hides deleted documents and deleted contracts (404) without regenerating anything on read', async () => {
    const a = world.contracts.a;
    const before = await h.prisma.eDocument.count({ where: { contractId: a.id } });
    const removed = await h.prisma.eDocument.create({ data: { contractId: a.id, documentType: 'CONTRACT', fileUrl: generated.contract!.fileUrl, fileHash: generated.contract!.fileHash, createdById: world.users.owner.id, deletedAt: new Date() } });
    const client = h.client({ session: owner });
    await client.get(`/documents/${removed.id}/download`).expect(404);
    const listing = await client.get(`/contracts/${a.id}/e-documents`).expect(200);
    expect(listing.body.data.data.map((row: { id: string }) => row.id)).not.toContain(removed.id);
    await h.prisma.contract.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    try {
      await client.get(`/documents/${generated.contract!.id}/download`).expect(404);
      await client.get(`/contracts/${a.id}/preview`).expect(404);
      await client.post(`/contracts/${a.id}/generate-signed-documents`).expect(404);
    } finally {
      await h.prisma.contract.update({ where: { id: a.id }, data: { deletedAt: null } });
    }
    const missingFile = await h.prisma.eDocument.create({ data: { contractId: a.id, documentType: 'CONTRACT', fileUrl: `contracts/2026/${a.contractNumber}/CONTRACT_missing.pdf`, fileHash: 'missing', createdById: world.users.owner.id } });
    try {
      const response = await client.get(`/documents/${missingFile.id}/download`);
      expect([400, 503]).toContain(response.status);
      expect(response.headers['content-type']).toMatch(/json/);
    } finally {
      await h.prisma.eDocument.update({ where: { id: missingFile.id }, data: { deletedAt: new Date() } });
    }
    expect(await h.prisma.eDocument.count({ where: { contractId: a.id } })).toBe(before + 2);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/deleted-and-missing`, title: 'Deleted document / deleted contract → 404; missing storage object → JSON error, no regeneration', routes: ['GET /api/documents/:id/download', 'GET /api/contracts/:id/e-documents', 'GET /api/contracts/:id/preview'], renderer: 'none', artifacts: [] }));
  });

  it('answers signed-url requests with an explicit 501 in local storage instead of a fake link', async () => {
    const response = await h.client({ session: salesA }).get(`/documents/${generated.contract!.id}/signed-url`).expect(501);
    expect(response.body.message).toContain('signed URL');
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/signed-url-unsupported`, title: 'GET /documents/:id/signed-url → 501 with Thai message under local storage', routes: ['GET /api/documents/:id/signed-url'], renderer: 'none', artifacts: [], unverified: ['GCS/S3 signed URL issuance (needs real bucket — DOC-13)'] }));
  });

  it('applies template font/size overrides identically in preview HTML and the Chromium PDF, keeping a long consent with its signature', async () => {
    const a = world.contracts.a;
    const admin = h.client({ session: owner });
    const contractHtml = readFileSync(join(__dirname, '../../src/modules/contracts/templates/hire-purchase-contract.html'), 'utf8');
    const contractSettings = { letterhead: 'none', margins: { ...DOCUMENT_STYLE.marginsMm }, fontSize: { body: 17, heading: 20, footer: 11 } };
    const contractTemplate = await admin.post('/contract-templates', { name: `${world.prefix} contract override`, type: 'STORE_DIRECT', contentHtml: contractHtml, settings: contractSettings, isActive: true }).expect(201);
    templates.push(contractTemplate.body.data.id);

    const paragraph = 'ข้าพเจ้ารับทราบว่าบริษัทจะเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้าเพื่อการทำสัญญาเช่าซื้อ การติดตามหนี้ การจัดทำเอกสารทางกฎหมาย และการติดต่อสื่อสารเกี่ยวกับสัญญา ตามที่ระบุไว้ในประกาศความเป็นส่วนตัวของบริษัทโดยครบถ้วน';
    const longConsent = `<div>
      <h1 style="text-align:center">หนังสือยินยอมให้เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคล</h1>
      <p style="text-align:center">สัญญาเลขที่: <strong>{contract_number}</strong> | วันที่: {contract_date}</p>
      <p>ข้าพเจ้า <strong>{customer_name}</strong> เลขบัตรประชาชน {national_id} ที่อยู่ {customer_address}</p>
      ${Array.from({ length: 48 }, (_, i) => `<p style="text-indent:2em;margin:0 0 6px">ข้อ ${i + 1} ${paragraph}</p>`).join('\n')}
      <div class="no-break">
        <p><strong>ข้าพเจ้าขอยืนยันความยินยอมข้างต้นทุกประการ</strong> และได้ลงลายมือชื่อไว้เป็นหลักฐาน</p>
        <div style="display:flex;justify-content:space-around;margin-top:20px">
          <div style="text-align:center"><p style="margin:0">ลงชื่อ {pdpa_signature} ผู้ให้ความยินยอม</p><p style="margin:4px 0 0">({customer_name})</p><p class="doc-note" style="margin:2px 0 0">วันที่ {pdpa_consent_date}</p></div>
          <div style="text-align:center"><p style="margin:0">ลงชื่อ {staff_signature} ผู้รับความยินยอม</p><p style="margin:4px 0 0">({salesperson_name})</p></div>
        </div>
      </div>
    </div>`;
    const pdpaSettings = { letterhead: 'none', margins: { ...DOCUMENT_STYLE.marginsMm }, fontSize: { body: 15, heading: 20, footer: 11 } };
    const pdpaTemplate = await admin.post('/contract-templates', { name: `${world.prefix} pdpa long`, type: 'PDPA_CONSENT', contentHtml: longConsent, settings: pdpaSettings, isActive: true }).expect(201);
    templates.push(pdpaTemplate.body.data.id);

    const preview = await admin.get(`/contracts/${a.id}/preview`).expect(200);
    expect(preview.body.data.html).toContain('font-size: 17pt');
    expect(preview.body.data.html).toContain('font-size: 20pt');
    expect(preview.body.data.html).toContain('font-size: 11pt');
    saveArtifact(DOMAIN, 'contract-preview-override.html', preview.body.data.html);

    const regenerated = await admin.post(`/contracts/${a.id}/generate-signed-documents`).expect(201);
    const { contract, pdpa, errors } = regenerated.body.data as { contract: GeneratedDoc; pdpa: GeneratedDoc; errors?: string[] };
    expect(errors).toBeUndefined();
    expect(contract.fileUrl).not.toBe(generated.contract!.fileUrl);

    const contractPdf = await parsePdf(stored(contract));
    expect(contractPdf.pages.every(isA4)).toBe(true);
    expect(contractPdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    expect(textSizes(contractPdf)[0].size).toBe(17);
    expect(sizesOfText(contractPdf, CONTRACT_TITLE)).toEqual([20]);
    expect(pageContaining(contractPdf, CLOSING)).toBe(pageContaining(contractPdf, `( ${world.customer.name} )`));

    const pdpaPdf = await parsePdf(stored(pdpa));
    expect(pdpaPdf.pageCount).toBeGreaterThanOrEqual(3);
    expect(pdpaPdf.pages.every(isA4)).toBe(true);
    expect(pdpaPdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
    expect(textSizes(pdpaPdf)[0].size).toBe(15);
    expect(sizesOfText(pdpaPdf, 'หนังสือยินยอมให้เก็บรวบรวม')).toEqual([20]);
    expect(sizesOfText(pdpaPdf, 'ข้อ 48')).toEqual([15]);
    const confirmPage = pageContaining(pdpaPdf, 'ข้าพเจ้าขอยืนยันความยินยอมข้างต้นทุกประการ');
    expect(confirmPage).toBe(pdpaPdf.pageCount);
    expect(pageContaining(pdpaPdf, 'ผู้ให้ความยินยอม')).toBe(confirmPage);
    expect(pageContaining(pdpaPdf, `(${world.customer.name})`)).toBe(confirmPage);
    expect(pageContaining(pdpaPdf, 'ข้อ 48')).toBeLessThanOrEqual(confirmPage);

    const artifacts = [
      saveArtifact(DOMAIN, 'contract-override.pdf', stored(contract)).relativePath,
      saveArtifact(DOMAIN, 'pdpa-long-override.pdf', stored(pdpa)).relativePath,
      saveArtifact(DOMAIN, 'contract-override.pdf.json', JSON.stringify({ settings: contractSettings, ...summary(contractPdf) }, null, 2)).relativePath,
      saveArtifact(DOMAIN, 'pdpa-long-override.pdf.json', JSON.stringify({ settings: pdpaSettings, ...summary(pdpaPdf), anchors: { confirmPage } }, null, 2)).relativePath,
      'contract-pdpa/contract-preview-override.html',
    ];
    for (const id of templates) await admin.patch(`/contract-templates/${id}`, { isActive: false }).expect(200);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/template-overrides`, title: 'Template fontSize overrides (17/20/11 contract, 15/20/11 PDPA) flow into preview HTML and Chromium PDF; 3-page consent keeps confirmation + signature together', routes: ['POST /api/contract-templates', 'PATCH /api/contract-templates/:id', 'GET /api/contracts/:id/preview', 'POST /api/contracts/:id/generate-signed-documents'], artifacts, notes: 'client-side jsPDF export (ContractTemplatesPage → PDFExportModal) is browser code and is not covered here' }));
  });

  it('never called an outbound transport during the whole flow', () => {
    expect(h.external.calls).toEqual([]);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/no-outbound`, title: 'LINE/SMS/e-mail recorder stayed empty for the entire scenario file', routes: [], renderer: 'none', artifacts: [] }));
  });
});
