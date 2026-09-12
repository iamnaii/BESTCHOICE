import { PrismaService } from '../../src/prisma/prisma.service';
import { DocumentsService } from '../../src/modules/contracts/documents.service';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER } from '../../src/utils/test-data-markers';

/** Synthetic identities, real document generation and local file storage only. */
export async function seedPreviewDocuments(db: PrismaService, documents: DocumentsService, actorId: string) {
  if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Disposable document preview required');
  const number = `${TEST_DOC_PREFIX}LOCAL-DOCUMENTS`;
  let contract = await db.contract.findUnique({ where: { contractNumber: number } });
  if (!contract) {
    const branch = await db.branch.findFirstOrThrow({ where: { name: 'LOCAL PREVIEW BRANCH', deletedAt: null } });
    const customer = await db.customer.create({ data: { name: `${TEST_NAME_PREFIX} — เอกสารสัญญา`, phone: '0800000088', nationalId: '7900000000088', birthDate: new Date('1990-01-01') } });
    const product = await db.product.create({ data: { name: `${TEST_NAME_PREFIX} — เครื่องตัวอย่างเอกสาร`, brand: 'LOCAL', model: 'DOCS', category: 'PHONE_NEW', costPrice: 6000, cashPrice: 10000, installmentPrice: 10000, branchId: branch.id } });
    const consent = await db.pDPAConsent.create({ data: { customerId: customer.id, consentVersion: 'test', privacyNoticeText: `${TEST_NOTE_MARKER} เอกสารตัวอย่าง`, status: 'GRANTED', grantedAt: new Date() } });
    contract = await db.contract.create({ data: { contractNumber: number, customerId: customer.id, productId: product.id, branchId: branch.id, salespersonId: actorId,
      planType: 'STORE_DIRECT', sellingPrice: 10000, downPayment: 2000, financedAmount: 8000, interestRate: 0.01, interestTotal: 480, totalMonths: 6, monthlyPayment: 1413.33, pdpaConsentId: consent.id,
      signatures: { create: (['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const).map(signerType => ({ signerType, signatureImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' })) } } });
  }
  if (!await db.eDocument.count({ where: { contractId: contract.id, deletedAt: null } })) {
    await documents.generateSignedDocuments(contract.id, actorId);
  }
  return { contractId: contract.id };
}
