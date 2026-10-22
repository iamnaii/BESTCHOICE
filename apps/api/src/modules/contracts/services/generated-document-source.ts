import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { safeEmbeddedImage } from './generated-document-effects';
import { Prisma } from '@prisma/client';
import {
  AccessGeneratedDocumentsBoundaries,
  GeneratedAuthority,
  GeneratedOriginalSources,
  generatedDenied,
} from '../../employee-access/access-generated-documents-boundaries';
import { ContractTemplateService } from './contract-template.service';
import { DOCUMENT_SOURCE_INCLUDE, documentSourceRevision } from './document-source.util';
import { matchesDocumentMime } from './document-mime.util';
import { createHash } from 'node:crypto';
export const GENERATED_CONFIG_KEYS = [
  'company_director',
  'company_director_id',
  'company_director_address',
  'company_name_th',
  'company_tax_id',
  'company_name_en',
  'company_address',
  'contract_penalty_rate',
  'contract_warranty_days',
  'contract_early_discount',
  'contract_min_months_early',
  'lessor_signature_image',
  'lessor_signer_name',
] as const;
export type GeneratedType = 'CONTRACT' | 'PDPA_CONSENT';
export interface TemplateChoice {
  templateSource?: 'BUILTIN';
  templateId?: string;
}
export interface GeneratedManifest extends GeneratedOriginalSources {
  version: 1;
  template: { kind: 'BUILTIN' | 'CUSTOM'; id: string | null; revision: string };
  photos: Array<{ documentId: string; identityId: string }>;
  config: Array<{ id: string; key: string; revision: string }>;
}
type CanonicalSource = Prisma.ContractGetPayload<{ include: typeof DOCUMENT_SOURCE_INCLUDE }>;
export interface PreparedGeneratedDocument {
  source: Omit<CanonicalSource, 'salesperson'> & { salesperson: { id: string; name: string } };
  sourceRevision: string;
  dependencyRevision: string;
  manifest: GeneratedManifest;
  html: string;
  settings: Prisma.JsonValue;
  config: Record<string, string>;
  photos: string[];
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const exceeds = () => new BadRequestException('ข้อมูลเอกสารเกินขอบเขตที่รองรับ');
export function parseGeneratedManifest(value: Prisma.JsonValue): GeneratedManifest {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw generatedDenied();
  const v = value as Record<string, Prisma.JsonValue>;
  const ids = (input: Prisma.JsonValue | undefined, max: number): input is string[] =>
    Array.isArray(input) &&
    input.length <= max &&
    input.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) &&
    new Set(input).size === input.length;
  if (
    v.version !== 1 ||
    !ids(v.products, 30) ||
    !ids(v.payments, 600) ||
    !ids(v.signatures, 20) ||
    typeof v.salesperson !== 'string' ||
    !(v.consent === null || typeof v.consent === 'string') ||
    !v.template ||
    typeof v.template !== 'object' ||
    Array.isArray(v.template) ||
    !['CUSTOM', 'BUILTIN'].includes(String(v.template.kind)) ||
    typeof v.template.revision !== 'string' ||
    !Array.isArray(v.photos) ||
    v.photos.length > 6 ||
    v.photos.some(
      (p) =>
        !p ||
        typeof p !== 'object' ||
        Array.isArray(p) ||
        typeof p.documentId !== 'string' ||
        typeof p.identityId !== 'string',
    ) ||
    !Array.isArray(v.config) ||
    v.config.length > GENERATED_CONFIG_KEYS.length ||
    v.config.some(
      (c) =>
        !c ||
        typeof c !== 'object' ||
        Array.isArray(c) ||
        typeof c.id !== 'string' ||
        typeof c.key !== 'string' ||
        !GENERATED_CONFIG_KEYS.includes(c.key as (typeof GENERATED_CONFIG_KEYS)[number]) ||
        typeof c.revision !== 'string',
    )
  )
    throw generatedDenied();
  return value as unknown as GeneratedManifest; // Runtime structural validation above, never an authority assertion.
}
/** Data preparation is inside the existing owned source transaction; effects are outside. */
export async function prepareGeneratedSource(
  proof: GeneratedAuthority,
  access: AccessGeneratedDocumentsBoundaries,
  templates: ContractTemplateService,
  type: string,
  choice: TemplateChoice,
): Promise<PreparedGeneratedDocument> {
  const { tx, parent } = proof;
  if (!parent || !proof.visible) throw generatedDenied();
  if (
    (choice.templateSource !== undefined && choice.templateSource !== 'BUILTIN') ||
    (choice.templateId && choice.templateSource)
  )
    throw new BadRequestException('ตัวเลือกแม่แบบไม่ถูกต้อง');
  const paymentIds = await tx.payment.findMany({
    where: { contractId: parent.id, deletedAt: null },
    select: { id: true },
    take: 601,
    orderBy: { id: 'asc' },
  });
  const signatureIds = await tx.signature.findMany({
    where: { contractId: parent.id, deletedAt: null },
    select: { id: true },
    take: 21,
    orderBy: { id: 'asc' },
  });
  if (paymentIds.length > 600 || signatureIds.length > 20) throw exceeds();
  const contract = await tx.contract.findUniqueOrThrow({
    where: { id: parent.id },
    select: { pdpaConsentId: true, planType: true, totalMonths: true },
  });
  if (contract.totalMonths > 600) throw exceeds();
  const originals: GeneratedOriginalSources = {
    products: [parent.productId],
    payments: paymentIds.map((p) => p.id),
    signatures: signatureIds.map((p) => p.id),
    consent: contract.pdpaConsentId,
    salesperson: parent.salespersonId,
  };
  await assertGeneratedSourceSize(tx, parent, contract.pdpaConsentId);
  if (!(await access.inputs(proof, originals))) throw generatedDenied();
  const raw = await tx.contract.findUniqueOrThrow({
    where: { id: parent.id },
    include: DOCUMENT_SOURCE_INCLUDE,
  });
  if (type === 'PDPA_CONSENT' && !raw.pdpaConsent)
    throw new BadRequestException('ยังไม่มีความยินยอม PDPA');
  if (
    raw.signatures.some((s) => !safeEmbeddedImage(s.signatureImage)) ||
    (raw.pdpaConsent?.signatureImage && !safeEmbeddedImage(raw.pdpaConsent.signatureImage))
  )
    throw generatedDenied();
  const sourceRevision = documentSourceRevision(raw);
  const source: PreparedGeneratedDocument['source'] = {
    ...raw,
    salesperson: { id: raw.salesperson.id, name: raw.salesperson.name },
  };
  let template: { id: string; contentHtml: string; settings: Prisma.JsonValue } | null = null;
  if (choice.templateSource !== 'BUILTIN') {
    const where = choice.templateId
      ? { id: choice.templateId, deletedAt: null, isActive: true }
      : {
          type: type === 'PDPA_CONSENT' ? 'PDPA_CONSENT' : raw.planType || 'STORE_DIRECT',
          deletedAt: null,
          isActive: true,
        };
    const selected = await tx.contractTemplate.findFirst({
      where,
      select: { id: true },
      orderBy:
        type === 'PDPA_CONSENT'
          ? [{ createdAt: 'desc' }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    if (choice.templateId && !selected) throw new BadRequestException('ไม่พบแม่แบบ');
    if (selected) {
      if (proof.managed && !proof.owner)
        throw new ForbiddenException('TEMPLATE_SOURCE_REQUIRES_OWNER');
      await tx.$queryRaw`SELECT id FROM contract_templates WHERE id=${selected.id} FOR SHARE`;
      const [bytes] = await tx.$queryRaw<
        Array<{ bytes: number }>
      >`SELECT octet_length(content_html)+COALESCE(octet_length(settings::text),0) AS bytes FROM contract_templates WHERE id=${selected.id}`;
      if (bytes.bytes > 2 * 1024 * 1024) throw exceeds();
      template = await tx.contractTemplate.findUniqueOrThrow({
        where: { id: selected.id },
        select: { id: true, contentHtml: true, settings: true },
      });
    }
  }
  const html = template?.contentHtml ?? templates.getDefaultTemplate(type);
  if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw exceeds();
  const [configSize] = await tx.$queryRaw<
    Array<{ bytes: bigint }>
  >`SELECT COALESCE(sum(octet_length(value)),0)::bigint AS bytes FROM system_config WHERE key=ANY(${[...GENERATED_CONFIG_KEYS]}::text[]) AND deleted_at IS NULL`;
  if (configSize.bytes > BigInt(2 * 1024 * 1024)) throw exceeds();
  await tx.$queryRaw`SELECT id FROM system_config WHERE key=ANY(${[...GENERATED_CONFIG_KEYS]}::text[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`;
  const configRows = await tx.systemConfig.findMany({
    where: { key: { in: [...GENERATED_CONFIG_KEYS] }, deletedAt: null },
    select: { id: true, key: true, value: true },
    orderBy: { key: 'asc' },
  });
  const photoRefs = html.includes('{device_photos_grid}')
    ? await tx.contractDocument.findMany({
        where: {
          contractId: parent.id,
          documentType: 'DEVICE_PHOTO',
          isLatest: true,
          deletedAt: null,
        },
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 6,
      })
    : [];
  if (
    photoRefs.length &&
    proof.snapshot &&
    ['contract-documents.read', 'contract-documents.export'].some(
      (key) =>
        !canAccess(
          proof.snapshot!,
          key as 'contract-documents.read' | 'contract-documents.export',
          { company: proof.company, branchId: parent.branchId },
        ),
    )
  )
    throw generatedDenied();
  const photos: string[] = [],
    photoSources: GeneratedManifest['photos'] = [];
  let photoBytes = 0;
  for (const ref of photoRefs) {
    await tx.$queryRaw`SELECT id FROM contract_documents WHERE id=${ref.id} FOR SHARE`;
    const [bounds] = await tx.$queryRaw<
      Array<{ bytes: number }>
    >`SELECT octet_length(file_url) AS bytes FROM contract_documents WHERE id=${ref.id}`;
    if (bounds.bytes > 15000000) throw exceeds();
    const doc = await tx.contractDocument.findUniqueOrThrow({
        where: { id: ref.id },
        include: { uploadIdentity: true },
      }),
      identity = doc.uploadIdentity;
    if (
      !identity ||
      identity.contractId !== parent.id ||
      identity.customerId !== parent.customerId ||
      identity.branchId !== parent.branchId ||
      identity.inlineValueHash !== hash(doc.fileUrl) ||
      identity.fileHash !== doc.fileHash ||
      identity.fileSize !== doc.fileSize ||
      identity.mimeType !== doc.mimeType
    )
      throw generatedDenied();
    const parts = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      doc.fileUrl,
    );
    if (!parts || parts[1] !== identity.mimeType) throw generatedDenied();
    const bytes = Buffer.from(parts[2], 'base64');
    if (
      !bytes.length ||
      bytes.length > 10 * 1024 * 1024 ||
      bytes.length !== identity.fileSize ||
      bytes.toString('base64') !== parts[2] ||
      !matchesDocumentMime(bytes, parts[1]) ||
      hash(bytes) !== identity.fileHash
    )
      throw generatedDenied();
    photoBytes += bytes.length;
    if (photoBytes > 20 * 1024 * 1024) throw exceeds();
    photos.push(doc.fileUrl);
    photoSources.push({ documentId: doc.id, identityId: identity.id });
  }
  const lessor = configRows.find((c) => c.key === 'lessor_signature_image')?.value;
  if (lessor && !safeEmbeddedImage(lessor)) throw generatedDenied();
  const manifest: GeneratedManifest = {
    version: 1,
    ...originals,
    template: {
      kind: template ? 'CUSTOM' : 'BUILTIN',
      id: template?.id ?? null,
      revision: documentSourceRevision({ html, settings: template?.settings ?? null }),
    },
    photos: photoSources,
    config: configRows.map((c) => ({ id: c.id, key: c.key, revision: hash(c.value) })),
  };
  return {
    source,
    sourceRevision,
    dependencyRevision: documentSourceRevision({ manifest, photos, config: configRows }),
    manifest,
    html,
    settings: template?.settings ?? null,
    config: Object.fromEntries(configRows.map((c) => [c.key, c.value])),
    photos,
  };
}

/** Scalar SQL bound before any complete canonical graph is materialized. */
export async function assertGeneratedSourceSize(
  tx: Prisma.TransactionClient,
  parent: NonNullable<GeneratedAuthority['parent']>,
  consentId: string | null,
) {
  const [size] = await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT (
    (SELECT octet_length(row_to_json(c)::text) FROM contracts c WHERE id=${parent.id}) +
    (SELECT octet_length(row_to_json(c)::text) FROM customers c WHERE id=${parent.customerId}) +
    (SELECT octet_length(row_to_json(p)::text) FROM products p WHERE id=${parent.productId}) +
    (SELECT octet_length(row_to_json(b)::text) FROM branches b WHERE id=${parent.branchId}) +
    (SELECT octet_length(row_to_json(u)::text) FROM users u WHERE id=${parent.salespersonId}) +
    COALESCE((SELECT sum(octet_length(row_to_json(p)::text)) FROM payments p WHERE contract_id=${parent.id} AND deleted_at IS NULL),0) +
    COALESCE((SELECT sum(octet_length(row_to_json(s)::text)) FROM signatures s WHERE contract_id=${parent.id} AND deleted_at IS NULL),0) +
    COALESCE((SELECT octet_length(row_to_json(p)::text) FROM pdpa_consents p WHERE id=${consentId}),0)
  )::bigint AS bytes`;
  if (!size || size.bytes > BigInt(24 * 1024 * 1024)) throw exceeds();
}
